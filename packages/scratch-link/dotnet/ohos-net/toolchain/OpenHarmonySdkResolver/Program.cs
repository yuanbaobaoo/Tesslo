using OpenHarmony.SdkResolution;

return ResolverProgram.Run(args);

internal static class ResolverProgram
{
    public static int Run(string[] args)
    {
        try
        {
            Dictionary<string, string> options = ParseOptions(args);
            string sdkRoot = GetRequiredOption(options, "--sdk-root");
            string apiText = GetRequiredOption(options, "--api");
            string output = GetRequiredOption(options, "--output");
            if (!int.TryParse(apiText, out int apiLevel))
            {
                throw new ArgumentException($"--api must be an integer, but was '{apiText}'.");
            }

            OpenHarmonySdkResolution resolution = OpenHarmonySdkResolver.Resolve(
                sdkRoot,
                apiLevel);
            resolution.WriteProps(output);
            Console.WriteLine(
                $"Resolved OpenHarmony API {apiLevel} to '{resolution.NativeRoot}' " +
                $"(manifest SHA-256 {resolution.ManifestSha256}).");
            return 0;
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidDataException or IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"OpenHarmony SDK resolution failed: {exception.Message}");
            return 1;
        }
    }

    private static Dictionary<string, string> ParseOptions(string[] args)
    {
        Dictionary<string, string> options = new(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index += 2)
        {
            if (index + 1 >= args.Length || !args[index].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException(
                    "Usage: OpenHarmonySdkResolver --sdk-root <path> --api <level> --output <props-path>.");
            }

            if (!options.TryAdd(args[index], args[index + 1]))
            {
                throw new ArgumentException($"Option '{args[index]}' was supplied more than once.");
            }
        }

        string[] knownOptions = ["--sdk-root", "--api", "--output"];
        string? unknownOption = options.Keys.FirstOrDefault(
            key => !knownOptions.Contains(key, StringComparer.Ordinal));
        if (unknownOption is not null)
        {
            throw new ArgumentException($"Unknown option '{unknownOption}'.");
        }

        return options;
    }

    private static string GetRequiredOption(Dictionary<string, string> options, string name)
    {
        if (!options.TryGetValue(name, out string? value) || string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException($"Required option '{name}' was not supplied.");
        }

        return value;
    }
}
