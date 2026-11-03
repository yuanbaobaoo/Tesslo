// OpenSSL 兼容层：OHOS NativeAOT runtime pack 的 libssl.so.3 是精简构建，
// 缺少 .NET OpenSSL shim 初始化时强制解析的 OCSP_basic_verify / PKCS7_sign
// 与 OpenSSL_version_num。本库命名为 libssl.so.3，其余符号由 NEEDED 的
// libssl_ohos.so 提供，并补上缺失符号，避免 InitializeOpenSSLShim abort。
// 与 scripts/build-link-csharp.mjs 的部署逻辑互相引用；改动需两侧同步。

#include <stddef.h>

// .NET shim 优先 dlsym OpenSSL_version_num；精简 libssl 未导出时回退到
// local_OpenSSL_version_num()，后者调用未绑定的 SSLeay() 造成空指针。
// 该库实际是 OpenSSL 1.1.1w，按 MNNFFPPS 编码返回 0x1010107f。
unsigned long OpenSSL_version_num(void)
{
    return 0x1010107fUL;
}

// OpenSSL 约定：0 表示校验失败；只有真正使用 OCSP 的调用方才需要成功路径
int OCSP_basic_verify(void *basicResponse, void *certs, void *store, unsigned long flags)
{
    (void)basicResponse;
    (void)certs;
    (void)store;
    (void)flags;
    return 0;
}

// 返回 NULL 表示签名失败；Scratch Link 不使用 PKCS7
void *PKCS7_sign(void *signCert, void *pkey, void *certs, void *data, int flags)
{
    (void)signCert;
    (void)pkey;
    (void)certs;
    (void)data;
    (void)flags;
    return NULL;
}
