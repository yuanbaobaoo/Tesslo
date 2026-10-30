using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;

namespace OpenHarmony.SdkResolution;

public sealed record OpenHarmonySdkResolution(
    int ApiLevel,
    string FolderName,
    string NativeRoot,
    string ManifestPath,
    string ManifestSha256,
    string PackageVersion,
    string ReleaseType)
{
    public void WriteProps(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        string fullPath = Path.GetFullPath(path);
        Directory.CreateDirectory(Path.GetDirectoryName(fullPath)!);

        XmlWriterSettings settings = new()
        {
            Encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            Indent = true,
            NewLineChars = Environment.NewLine,
        };

        using XmlWriter writer = XmlWriter.Create(fullPath, settings);
        writer.WriteStartDocument();
        writer.WriteStartElement("Project");
        writer.WriteStartElement("PropertyGroup");
        WriteProperty(writer, "OpenHarmonyApiLevel", ApiLevel.ToString(CultureInfo.InvariantCulture));
        WriteProperty(writer, "OpenHarmonySdkFolder", FolderName);
        WriteProperty(writer, "OpenHarmonyNativeRoot", NativeRoot);
        WriteProperty(writer, "OpenHarmonySdkManifestPath", ManifestPath);
        WriteProperty(writer, "OpenHarmonySdkManifestSha256", ManifestSha256);
        WriteProperty(writer, "OpenHarmonySdkPackageVersion", PackageVersion);
        WriteProperty(writer, "OpenHarmonySdkReleaseType", ReleaseType);
        writer.WriteEndElement();
        writer.WriteEndElement();
        writer.WriteEndDocument();
    }

    private static void WriteProperty(XmlWriter writer, string name, string value)
    {
        writer.WriteElementString(name, value);
    }
}

public static class OpenHarmonySdkResolver
{
    private static readonly HashSet<int> SupportedApis =
        [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26];

    public static OpenHarmonySdkResolution Resolve(string sdkRoot, int apiLevel)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sdkRoot);

        if (apiLevel == 25)
        {
            throw new InvalidDataException(
                "API 25 is intentionally unsupported because no compatible SDK/image is available.");
        }

        if (!SupportedApis.Contains(apiLevel))
        {
            throw new InvalidDataException(
                $"API {apiLevel} is unsupported. Supported APIs are 13 through 24, and 26.");
        }

        string fullSdkRoot = Path.GetFullPath(sdkRoot);
        if (!Directory.Exists(fullSdkRoot))
        {
            throw new DirectoryNotFoundException($"OpenHarmony SDK root was not found: '{fullSdkRoot}'.");
        }

        List<SdkCandidate> matches = [];
        foreach (string packageDirectory in Directory.EnumerateDirectories(fullSdkRoot).Order(StringComparer.Ordinal))
        {
            string manifestPath = Path.Combine(packageDirectory, "native", "oh-uni-package.json");
            if (!File.Exists(manifestPath))
            {
                continue;
            }

            SdkCandidate candidate = ReadCandidate(packageDirectory, manifestPath);
            if (candidate.ApiLevel == apiLevel)
            {
                matches.Add(candidate);
            }
        }

        if (matches.Count == 0)
        {
            throw new InvalidDataException(
                $"No Native SDK manifest for API {apiLevel} was found directly under '{fullSdkRoot}'.");
        }

        if (matches.Count > 1)
        {
            throw new InvalidDataException(
                $"Found multiple Native SDK manifests for API {apiLevel}: " +
                string.Join(", ", matches.Select(candidate => $"'{candidate.ManifestPath}'")) + ".");
        }

        SdkCandidate selected = matches[0];
        ValidateSdkInputs(selected.NativeRoot);
        string manifestSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(selected.ManifestPath)));

        return new OpenHarmonySdkResolution(
            selected.ApiLevel,
            Path.GetFileName(selected.PackageDirectory),
            selected.NativeRoot,
            selected.ManifestPath,
            manifestSha256,
            selected.PackageVersion,
            selected.ReleaseType);
    }

    private static SdkCandidate ReadCandidate(string packageDirectory, string manifestPath)
    {
        try
        {
            using JsonDocument manifest = JsonDocument.Parse(File.ReadAllBytes(manifestPath));
            JsonElement root = manifest.RootElement;
            if (!root.TryGetProperty("apiVersion", out JsonElement apiElement))
            {
                throw new InvalidDataException($"SDK manifest is missing apiVersion: '{manifestPath}'.");
            }

            string? apiText = apiElement.ValueKind switch
            {
                JsonValueKind.String => apiElement.GetString(),
                JsonValueKind.Number => apiElement.GetRawText(),
                _ => null,
            };
            if (!int.TryParse(apiText, NumberStyles.None, CultureInfo.InvariantCulture, out int apiLevel))
            {
                throw new InvalidDataException($"SDK manifest has an invalid apiVersion: '{manifestPath}'.");
            }

            string packageVersion = GetOptionalString(root, "version");
            string releaseType = GetOptionalString(root, "releaseType");
            return new SdkCandidate(
                apiLevel,
                Path.GetFullPath(packageDirectory),
                Path.GetFullPath(Path.Combine(packageDirectory, "native")),
                Path.GetFullPath(manifestPath),
                packageVersion,
                releaseType);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException($"SDK manifest is not valid JSON: '{manifestPath}'.", exception);
        }
    }

    private static string GetOptionalString(JsonElement root, string propertyName)
    {
        return root.TryGetProperty(propertyName, out JsonElement property) &&
               property.ValueKind == JsonValueKind.String
            ? property.GetString() ?? string.Empty
            : string.Empty;
    }

    private static void ValidateSdkInputs(string nativeRoot)
    {
        RequireDirectory(Path.Combine(nativeRoot, "sysroot"), "sysroot");
        RequireExecutable(Path.Combine(nativeRoot, "llvm", "bin"), "clang");
        RequireExecutable(Path.Combine(nativeRoot, "llvm", "bin"), "ld.lld");
        RequireFile(
            Path.Combine(nativeRoot, "build", "cmake", "ohos.toolchain.cmake"),
            "CMake toolchain");
    }

    private static void RequireDirectory(string path, string description)
    {
        if (!Directory.Exists(path))
        {
            throw new DirectoryNotFoundException($"OpenHarmony {description} was not found: '{path}'.");
        }
    }

    private static void RequireExecutable(string directory, string name)
    {
        string platformPath = Path.Combine(directory, OperatingSystem.IsWindows() ? name + ".exe" : name);
        string alternatePath = Path.Combine(directory, OperatingSystem.IsWindows() ? name : name + ".exe");
        if (!File.Exists(platformPath) && !File.Exists(alternatePath))
        {
            throw new FileNotFoundException(
                $"OpenHarmony {name} was not found as '{platformPath}' or '{alternatePath}'.",
                platformPath);
        }
    }

    private static void RequireFile(string path, string description)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"OpenHarmony {description} was not found: '{path}'.", path);
        }
    }

    private sealed record SdkCandidate(
        int ApiLevel,
        string PackageDirectory,
        string NativeRoot,
        string ManifestPath,
        string PackageVersion,
        string ReleaseType);
}
