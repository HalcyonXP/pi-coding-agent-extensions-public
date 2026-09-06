// Local runtime containment helper; Apache-2.0. No guest source is compiled here.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public static class PiRuntimeJob {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long TotalUserTime, TotalKernelTime, ThisPeriodUserTime, ThisPeriodKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool ReadFile(IntPtr file, byte[] data, uint count, out uint read, IntPtr overlapped);
    static IntPtr job, parent;
    public static void Enter(int pid, ulong expectedCreation) {
        if (IntPtr.Size != 8) throw new InvalidOperationException();
        parent = OpenProcess(0x00100000 | 0x1000, false, pid); // SYNCHRONIZE + QUERY_LIMITED_INFORMATION
        FileTime creation, exit, kernel, user;
        if (parent == IntPtr.Zero || !GetProcessTimes(parent, out creation, out exit, out kernel, out user)) throw new InvalidOperationException();
        ulong actual = ((ulong)creation.High << 32) | creation.Low;
        if (actual != expectedCreation || WaitForSingleObject(parent, 0) != 258) throw new InvalidOperationException();
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new InvalidOperationException();
        var limits = new ExtendedLimits();
        // KILL_ON_CLOSE, PROCESS_MEMORY, JOB_MEMORY, JOB_TIME, ACTIVE_PROCESS.
        // No breakaway flag. Includes this supervisor and the single Node worker.
        limits.BasicLimitInformation.LimitFlags = 0x2000 | 0x100 | 0x200 | 0x4 | 0x8;
        limits.BasicLimitInformation.PerJobUserTimeLimit = 10L * 10000000L;
        limits.BasicLimitInformation.ActiveProcessLimit = 2;
        limits.ProcessMemoryLimit = new UIntPtr(256UL * 1024 * 1024);
        limits.JobMemoryLimit = new UIntPtr(384UL * 1024 * 1024);
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))) ||
            !AssignProcessToJobObject(job, GetCurrentProcess())) throw new InvalidOperationException();
        var watcher = new Thread(() => {
            // Exact parent handle; independently monitor combined user + kernel CPU.
            // The OS user-time backstop alone has observable accounting latency.
            while (WaitForSingleObject(parent, 50) == 258) {
                Accounting info;
                if (!QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) ||
                    info.TotalUserTime + info.TotalKernelTime >= 10L * 10000000L) {
                    TerminateJobObject(job, 72);
                    return;
                }
            }
            TerminateJobObject(job, 71);
        });
        watcher.IsBackground = true;
        watcher.Start();
        // Both handles are non-inherited and retained until supervisor teardown.
    }
    static async System.Threading.Tasks.Task Relay(System.IO.Stream source, System.IO.Stream destination) {
        var buffer = new byte[8192];
        int count;
        while ((count = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0) {
            await destination.WriteAsync(buffer, 0, count).ConfigureAwait(false);
            // Interactive RPC must not wait for a FileStream buffer to fill or EOF.
            await destination.FlushAsync().ConfigureAwait(false);
        }
    }
    public static int Run(string node, string worker) {
        if (worker.IndexOf('"') >= 0 || worker.IndexOf('\0') >= 0) throw new InvalidOperationException();
        var info = new System.Diagnostics.ProcessStartInfo(node, "--max-old-space-size=96 \"" + worker + "\"");
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        // Byte-stream relay, not PowerShell native-command or line/text conversion.
        // Fixed-size, explicitly flushed relays; never allocate a complete worker line.
        using (var child = System.Diagnostics.Process.Start(info)) {
            var input = Relay(Console.OpenStandardInput(), child.StandardInput.BaseStream);
            input.ContinueWith(task => {
                var observed = task.Exception;
                try { child.StandardInput.Close(); } catch { }
            });
            var output = Relay(child.StandardOutput.BaseStream, Console.OpenStandardOutput());
            var error = Relay(child.StandardError.BaseStream, Console.OpenStandardError());
            child.WaitForExit();
            System.Threading.Tasks.Task.WaitAll(output, error);
            return child.ExitCode;
        }
    }
    public static void StartGate() {
        // Read exactly the one-byte gate. Console.ReadLine could prefetch worker RPC input.
        var data = new byte[1]; uint read;
        if (!ReadFile(GetStdHandle(-10), data, 1, out read, IntPtr.Zero) || read != 1 || data[0] != 1) throw new InvalidOperationException();
        if (WaitForSingleObject(parent, 0) != 258) throw new InvalidOperationException();
    }

    public static int Main(string[] args) {
        try {
            Console.InputEncoding = new System.Text.UTF8Encoding(false);
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            if (args.Length == 2 && args[0] == "--parent-creation") {
                IntPtr handle = OpenProcess(0x00100000 | 0x1000, false, int.Parse(args[1]));
                FileTime creation, exit, kernel, user;
                if (handle == IntPtr.Zero) throw new InvalidOperationException();
                try {
                    if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user) || WaitForSingleObject(handle, 0) != 258) throw new InvalidOperationException();
                    Console.WriteLine(((ulong)creation.High << 32) | creation.Low);
                    return 0;
                } finally { CloseHandle(handle); }
            }
            if (args.Length != 4) throw new InvalidOperationException();
            Enter(int.Parse(args[0]), ulong.Parse(args[1]));
            Console.Error.WriteLine("PI_RUNTIME_READY_V1");
            StartGate();
            return Run(args[2], args[3]);
        } catch {
            Console.Error.WriteLine("PI_RUNTIME_SETUP_FAILED_V1");
            return 70;
        }
    }
}
