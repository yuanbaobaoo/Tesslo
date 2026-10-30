#include "napi/native_api.h"

#include <dlfcn.h>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

using StartFn = int (*)(int);
using StopFn = void (*)();
using VersionFn = const char* (*)();

void* g_library = nullptr;
StartFn g_start = nullptr;
StopFn g_stop = nullptr;
VersionFn g_version = nullptr;

std::string library_path() {
    Dl_info info{};
    if (dladdr(reinterpret_cast<void*>(&library_path), &info) == 0 || info.dli_fname == nullptr) {
        return "TessloLinkNative.so";
    }
    std::string path(info.dli_fname);
    const auto slash = path.find_last_of('/');
    if (slash == std::string::npos) return "ScratchLinkOhos.so";
    return path.substr(0, slash + 1) + "ScratchLinkOhos.so";
}

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

napi_value Start(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1] = {nullptr};
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    int32_t port = 20111;
    if (argc > 0) napi_get_value_int32(env, argv[0], &port);
    const int status = load_csharp() ? g_start(port) : -2;
    napi_value result;
    napi_create_int32(env, status, &result);
    return result;
}

napi_value Stop(napi_env env, napi_callback_info) {
    if (load_csharp()) g_stop();
    napi_value result;
    napi_get_undefined(env, &result);
    return result;
}

napi_value Version(napi_env env, napi_callback_info) {
    const char* version = load_csharp() ? g_version() : "unavailable";
    napi_value result;
    napi_create_string_utf8(env, version, NAPI_AUTO_LENGTH, &result);
    return result;
}

napi_value Init(napi_env env, napi_value exports) {
    napi_value start;
    napi_value stop;
    napi_value version;
    napi_create_function(env, "start", NAPI_AUTO_LENGTH, Start, nullptr, &start);
    napi_create_function(env, "stop", NAPI_AUTO_LENGTH, Stop, nullptr, &stop);
    napi_create_function(env, "version", NAPI_AUTO_LENGTH, Version, nullptr, &version);
    napi_set_named_property(env, exports, "start", start);
    napi_set_named_property(env, exports, "stop", stop);
    napi_set_named_property(env, exports, "version", version);
    return exports;
}

}  // namespace

NAPI_MODULE(tesslolink, Init)
