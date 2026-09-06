param([Parameter(Mandatory = $true)][string]$CommandBase64, [Parameter(Mandatory = $true)][uint32]$ParentProcessId)
$ErrorActionPreference = 'Stop'

# Assign this supervisor BEFORE executing user code. Every normally-created descendant
# inherits the non-breakaway job. The OS closes this non-inherited handle on any exit,
# killing the remaining tree. Failure to establish the job prevents command execution.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PiUnifiedExecJob {
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
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
    static IntPtr job, parent;
    public static void Enter(uint parentPid) {
        parent = OpenProcess(0x00100000, false, parentPid); // SYNCHRONIZE, held identity
        if (parent == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        var limits = new ExtendedLimits();
        limits.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) {
            int error = Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error);
        }
        if (!AssignProcessToJobObject(job, GetCurrentProcess())) {
            int error = Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error);
        }
        // The parent must acknowledge readiness AFTER this handle is held. A
        // reused PID after parent death cannot acknowledge through its old pipe.
        var watch = new System.Threading.Thread(() => {
            WaitForSingleObject(parent, 0xffffffff);
            TerminateJobObject(job, 1);
        });
        watch.IsBackground = true;
        watch.Start();
        // Deliberately retain both non-inherited handles until OS process teardown.
    }
}
'@
[PiUnifiedExecJob]::Enter($ParentProcessId)
[Console]::Error.WriteLine('PI_UNIFIED_READY_V1')
if ([Console]::OpenStandardInput().ReadByte() -ne 1) { throw 'Native supervisor gate closed.' }
$command = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CommandBase64))
$ErrorActionPreference = 'Continue'
& ([ScriptBlock]::Create($command))
$success = $?
if ($success) { exit 0 }
if ($LASTEXITCODE) { exit $LASTEXITCODE }
exit 1
