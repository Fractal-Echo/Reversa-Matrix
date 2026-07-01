Windows package runtime evidence fixture for D: The Game.

ArchiveLayout=portable zip extracted into a clean test copy
PackageRoot=DOSBOX
RuntimeRoot=DOSBOX
LaunchExecutable=DOSBOX/dosbox-x.exe
LaunchArguments=-conf DOSBOX/dosbox-x.conf -noconsole
ConfigFile=DOSBOX/dosbox-x.conf
ShaderPath=DOSBOX/SHADERS/fixvideo.fx
ExecutableBitness=x64 host with a separate win32 fallback
DLLLoadOrder=DOSBOX/glide2x.dll before any optional dxgi.dll proxy DLL
RuntimeDependencies=SDL2.dll, Visual C++ runtime, DirectX Runtime, D3DCompiler_47.dll
LeastTranslationLayers=D.EXE -> DOSBox-X -> host OpenGL output before DXVK, dgVoodoo, Special K, Lossless Scaling, or LSFG
RollbackPlan=restore original DOSBOX folder from backup and keep the SVN-Daum package preserved as control evidence

This package is a Reversa investigation lane for Windows packaging issues:
archive layout, executable bitness, DLL dependencies, config names, shader
compatibility, launch arguments, least translation layers, and rollback steps.
