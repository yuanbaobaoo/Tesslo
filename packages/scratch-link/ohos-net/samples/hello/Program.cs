using System.Runtime.InteropServices;

Console.WriteLine("openharmony nativeaot hello");
Console.WriteLine($"runtime={RuntimeInformation.FrameworkDescription}");
Console.WriteLine($"os={RuntimeInformation.OSDescription}");
Console.WriteLine($"arch={RuntimeInformation.ProcessArchitecture}");
Console.WriteLine($"pagesize={NativeRuntime.GetPageSize()}");

return 0;

static class NativeRuntime
{
    [DllImport("libc", EntryPoint = "getpagesize")]
    public static extern int GetPageSize();
}
