# Wrapper Chain

Baseline:

PANDY3.EXE -> glide.dll -> bundled nGlide -> Direct3D.

Vulkan candidate:

PANDY3.EXE -> dgVoodoo x86 Glide.dll -> Direct3D11 -> DXVK x32 d3d11.dll and dxgi.dll -> Vulkan.

Direct3D12 candidate:

PANDY3.EXE -> dgVoodoo x86 Glide.dll -> Direct3D12.

Risk:

dgVoodoo Direct3D12 uses FLIP_DISCARD swapchains and may be worse for old games with mixed GDI, DirectDraw, movie, or menu surfaces. Prefer D3D11 for the first Vulkan chain.
