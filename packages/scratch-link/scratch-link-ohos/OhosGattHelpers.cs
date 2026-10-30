// GATT UUID 帮助类的 OHOS 实现。TUUID 选择 string：设备内 BLE 桥
// （apps/tesslo/entry/src/main/ets/ble/BleTcpBridge.ets）以小写 UUID 字符串通信。

namespace ScratchLink.Ohos;

using System.Globalization;
using ScratchLink.BLE;

internal class OhosGattHelpers : GattHelpers<string>
{
    /// <summary>
    /// Bluetooth base UUID suffix shared by all 16-bit alias expansions,
    /// matching the upstream Windows implementation's <c>Guid(alias, 0, 0x1000, ...)</c>.
    /// </summary>
    private const string BaseUuidSuffix = "-0000-1000-8000-00805f9b34fb";

    /// <inheritdoc/>
    public override string CanonicalUuid(uint alias) =>
        string.Format(CultureInfo.InvariantCulture, "0000{0:x4}{1}", (ushort)alias, BaseUuidSuffix);

    /// <inheritdoc/>
    public override string MakeUUID(string name) => name.ToLowerInvariant();
}
