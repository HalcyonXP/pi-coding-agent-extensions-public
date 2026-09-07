param([Parameter(Mandatory = $true)][string]$CommandBase64, [Parameter(Mandatory = $true)][uint32]$ParentProcessId, [Parameter(Mandatory = $true)][string]$VerifiedHelperPath)
$ErrorActionPreference = 'Stop'

# Assign this supervisor BEFORE executing user code. Every normally-created descendant
# inherits the non-breakaway job. The OS closes this non-inherited handle on any exit,
# killing the remaining tree. Failure to establish the job prevents command execution.
# The parent verified this source/recipe-bound assembly before launch. Loading
# its independent shell type does not run the restricted coordinator entry point.
# No invocation-time C# compiler or alternate unverified helper is permitted.
[void][Reflection.Assembly]::LoadFile($VerifiedHelperPath)
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
