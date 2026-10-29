namespace Tesslo.Link;

internal static class Sha1
{
    public static byte[] Hash(ReadOnlySpan<byte> data)
    {
        var paddedLength = ((data.Length + 9 + 63) / 64) * 64;
        var buffer = new byte[paddedLength];
        data.CopyTo(buffer);
        buffer[data.Length] = 0x80;
        var bitLength = (ulong)data.Length * 8;
        for (var index = 0; index < 8; index++)
        {
            buffer[paddedLength - 1 - index] = (byte)(bitLength >> (8 * index));
        }

        uint h0 = 0x67452301;
        uint h1 = 0xEFCDAB89;
        uint h2 = 0x98BADCFE;
        uint h3 = 0x10325476;
        uint h4 = 0xC3D2E1F0;
        var words = new uint[80];

        for (var offset = 0; offset < paddedLength; offset += 64)
        {
            for (var index = 0; index < 16; index++)
            {
                var position = offset + index * 4;
                words[index] = (uint)(buffer[position] << 24 | buffer[position + 1] << 16 |
                                      buffer[position + 2] << 8 | buffer[position + 3]);
            }
            for (var index = 16; index < 80; index++)
            {
                var value = words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16];
                words[index] = (value << 1) | (value >> 31);
            }

            uint a = h0, b = h1, c = h2, d = h3, e = h4;
            for (var index = 0; index < 80; index++)
            {
                uint f;
                uint k;
                if (index < 20)
                {
                    f = (b & c) | (~b & d);
                    k = 0x5A827999;
                }
                else if (index < 40)
                {
                    f = b ^ c ^ d;
                    k = 0x6ED9EBA1;
                }
                else if (index < 60)
                {
                    f = (b & c) | (b & d) | (c & d);
                    k = 0x8F1BBCDC;
                }
                else
                {
                    f = b ^ c ^ d;
                    k = 0xCA62C1D6;
                }

                var temp = ((a << 5) | (a >> 27)) + f + e + k + words[index];
                e = d;
                d = c;
                c = (b << 30) | (b >> 2);
                b = a;
                a = temp;
            }

            h0 += a;
            h1 += b;
            h2 += c;
            h3 += d;
            h4 += e;
        }

        var output = new byte[20];
        WriteUInt32(output, 0, h0);
        WriteUInt32(output, 4, h1);
        WriteUInt32(output, 8, h2);
        WriteUInt32(output, 12, h3);
        WriteUInt32(output, 16, h4);
        return output;
    }

    private static void WriteUInt32(byte[] buffer, int offset, uint value)
    {
        buffer[offset] = (byte)(value >> 24);
        buffer[offset + 1] = (byte)(value >> 16);
        buffer[offset + 2] = (byte)(value >> 8);
        buffer[offset + 3] = (byte)value;
    }
}
