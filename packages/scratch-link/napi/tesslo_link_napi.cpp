// C# ScratchLinkOhos.so 的 NAPI 包装：把 [UnmanagedCallersOnly] 导出暴露为 JS API。
// 符号约定与 scratch-link-ohos/Exports.cs 一致：TessloLinkStart/Stop/Version，
// 任一侧修改符号/参数/返回码时需同步另一侧。
// 仅在 ArkTS/JS 主线程（libuv 单线程）调用，以下全局句柄不做加锁。

#include "napi/native_api.h"

#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

using StartFn = int (*)(int);
using StopFn = void (*)();
using VersionFn = const char* (*)();

// 进程生命周期内持有、不 dlclose：Stop 之后保留符号以便再次 Start
void* g_library = nullptr;
StartFn g_start = nullptr;
StopFn g_stop = nullptr;
VersionFn g_version = nullptr;

// 取本 so 所在目录下的 ScratchLinkOhos.so（部署名见 scripts/build-link-csharp.mjs）；
// dladdr 失败或路径无分隔符时退回裸文件名，交由 dlopen 默认搜索路径解析
std::string library_path() {
    Dl_info info{};
    if (dladdr(reinterpret_cast<void*>(&library_path), &info) == 0 || info.dli_fname == nullptr) {
        return "ScratchLinkOhos.so";
    }
    std::string path(info.dli_fname);
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos) return "ScratchLinkOhos.so";
    return path.substr(0, slash + 1) + "ScratchLinkOhos.so";
}

// 幂等加载 C# 动态库并解析三个导出符号；任一符号缺失视为加载失败
bool load_csharp() {
    if (g_library != nullptr) return true;
    const auto path = library_path();
    g_library = dlopen(path.c_str(), RTLD_NOW | RTLD_GLOBAL);
    if (g_library == nullptr) {
        fprintf(stderr, "tesslo-link: dlopen %s failed: %s\n", path.c_str(), dlerror());
        return false;
    }
    g_start = reinterpret_cast<StartFn>(dlsym(g_library, "TessloLinkStart"));
    g_stop = reinterpret_cast<StopFn>(dlsym(g_library, "TessloLinkStop"));
    g_version = reinterpret_cast<VersionFn>(dlsym(g_library, "TessloLinkVersion"));
    if (g_start == nullptr || g_stop == nullptr || g_version == nullptr) {
        fprintf(stderr, "tesslo-link: missing C# exports\n");
        return false;
    }
    return true;
}

// JS: start(port?) -> number  转发 TessloLinkStart；未传端口默认 20111
napi_value Start(napi_env env, napi_callback_info info) {
    try {
        size_t argc = 1;
        napi_value argv[1] = {nullptr};
        if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok) {
            napi_throw_error(env, nullptr, "failed to read arguments");
            return nullptr;
        }
        int32_t port = 20111;
        if (argc > 0 && napi_get_value_int32(env, argv[0], &port) != napi_ok) {
            napi_throw_type_error(env, nullptr, "port must be a number");
            return nullptr;
        }
        const int status = load_csharp() ? g_start(port) : -2;
        napi_value result;
        if (napi_create_int32(env, status, &result) != napi_ok) {
            napi_throw_error(env, nullptr, "failed to create result");
            return nullptr;
        }
        return result;
    } catch (...) {
        // C++ 异常禁止穿过 NAPI 边界，兜底转成 JS 错误
        napi_throw_error(env, nullptr, "tesslo-link internal error");
        return nullptr;
    }
}

// JS: stop() -> undefined  转发 TessloLinkStop
napi_value Stop(napi_env env, napi_callback_info) {
    try {
        if (load_csharp()) g_stop();
        napi_value result;
        if (napi_get_undefined(env, &result) != napi_ok) {
            return nullptr;
        }
        return result;
    } catch (...) {
        napi_throw_error(env, nullptr, "tesslo-link internal error");
        return nullptr;
    }
}

// JS: version() -> string  转发 TessloLinkVersion
napi_value Version(napi_env env, napi_callback_info) {
    try {
        // C# 侧返回静态只读数据段指针（含结尾 '\0'，进程生命周期有效），
        // 此处仅复制内容，无需释放，不存在所有权转移
        const char* version = load_csharp() ? g_version() : "unavailable";
        napi_value result;
        if (napi_create_string_utf8(env, version, NAPI_AUTO_LENGTH, &result) != napi_ok) {
            return nullptr;
        }
        return result;
    } catch (...) {
        napi_throw_error(env, nullptr, "tesslo-link internal error");
        return nullptr;
    }
}

// 模块加载时注册 start/stop/version 三个函数；任一步失败返回 nullptr 终止加载
napi_value Init(napi_env env, napi_value exports) {
    try {
        napi_value start;
        napi_value stop;
        napi_value version;
        if (napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &start) != napi_ok ||
            napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, nullptr, &stop) != napi_ok ||
            napi_create_function(env, "version", NAPI_AUTO_LENGTH, Version, nullptr, &version) != napi_ok ||
            napi_set_named_property(env, exports, "start", start) != napi_ok ||
            napi_set_named_property(env, exports, "stop", stop) != napi_ok ||
            napi_set_named_property(env, exports, "version", version) != napi_ok) {
            return nullptr;
        }
        return exports;
    } catch (...) {
        return nullptr;
    }
}

}  // namespace

NAPI_MODULE(tesslolink, Init)
