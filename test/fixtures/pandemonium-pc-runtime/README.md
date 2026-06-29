# Pandemonium PC Runtime Fixture

Pandemonium! Steam AppId=243020. GOGID=1207659054. TargetExe=PANDY3.EXE.
The Steam build is DRM-free when launched directly from PANDY3.EXE.

Executable evidence:

- PANDY.EXE is the software/DirectDraw path.
- PANDY3.EXE is the 3Dfx Glide path.
- file output: PANDY3.EXE: PE32 executable for MS Windows, Intel i386.
- SHA256Before=ECEFF295D4D5C63F925242E8C79F3EEEAFEA2FB22BCF22715419DA80E611BF14.

Runtime boundary:

- 32-bit x86 process cannot load 64-bit wrapper DLLs.
- Real 64-bit support requires a source port, reimplementation, or Unreal Engine 5 runtime that reads converted assets.
- Do not treat wrapper stabilization as a true 64-bit port.

Wrapper lane:

- PANDY3.exe imports glide.dll.
- Bundled files include glide.dll, 3DfxSpl.dll, SST1INIT.DLL, win32.dll, XanLib.dll.
- nGlide translates Glide calls to Direct3D and supports high resolution modes.
- dgVoodoo can wrap Glide to Direct3D11 or Direct3D12.
- Vulkan experiment chain: PANDY3.EXE -> Glide -> dgVoodoo x86 Glide.dll -> D3D11 -> DXVK x32 d3d11.dll/dxgi.dll -> Vulkan.
- Control chain: PANDY3.EXE -> bundled nGlide.

Known fix/risk lane:

- PCGamingWiki notes Windows 10 start failures.
- PCGamingWiki notes music not playing.
- PCGamingWiki fix lane mentions WinMM and newer nGlide.
- Registry path: HKCU\SOFTWARE\Crystal Dynamics\Pandemonium.
- User review reports ESC/pause menu crashes, controller setup instability, and black screen hangs.

Asset lane:

- Archive files include JESTERS.PKG, SJESTERS.PKG, LEVEL21.PKG, LEVEL65.PKG, LEVEL653.PKG, LEVEL66.PKG, LEVEL663.PKG, LEVEL67.PKG, LEVEL673.PKG, LEVEL68.PKG, LEVEL683.PKG, LEVEL75.PKG, LEVEL76.PKG, LEVEL77.PKG, LEVEL96.PKG, LEVEL97.PKG.
- CNF manifests include FULL.CNF, FULL3.CNF, COMPACT.CNF, COMPACT3.CNF, RESOURCE.CNF.
- CHARLES.EXE includes BMP tooling examples: JEANFACE.BMP and KINGHEAD.BMP.
- First task is PKG table/header mapping, then texture/model/animation extraction, then replacement import proof.

Video lane:

- INTROS.AVI, LOGOS.AVI, OUTROS.AVI use XanLib.
- ffprobe identifies xan_wc4 video and xan_dpcm audio.
- PC FMV baseline is 320x240 at 15 fps.
- Video upgrades need codec playback proof in the original EXE or a new runtime video player in the remaster.

Remaster lane:

- The PC version can have worse quality than the PlayStation/PS1 source.
- Proper PC port/remaster target: asset extraction, texture upscale, model upgrade, animation proof, video replacement, and source-port/Unreal Engine 5 runtime.
