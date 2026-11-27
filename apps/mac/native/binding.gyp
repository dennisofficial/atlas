{
  "targets": [
    {
      "target_name": "atlas_native",
      "sources": ["src/atlas_native.mm"],
      "include_dirs": [
        "<!(node -p \"require('node-addon-api').include_dir\")",
        "include"
      ],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "MACOSX_DEPLOYMENT_TARGET": "14.0",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES"
            },
            "libraries": [
              "-L<(module_root_dir)/build/swift",
              "-lAtlasNativeUI",
              "-L/usr/lib/swift",
              "-lswiftCore",
              "-framework AppKit",
              "-framework SwiftUI",
              "-framework QuartzCore"
            ],
            "OTHER_LDFLAGS": ["-Wl,-rpath,/usr/lib/swift", "-Wl,-rpath,@loader_path"]
          }
        ]
      ]
    }
  ]
}
