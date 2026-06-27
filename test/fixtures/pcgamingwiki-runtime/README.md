# PCGamingWiki-Style Compatibility Notes

Availability: Steam AppID 311210, Steam Cloud, and version differences between
Steam and Microsoft Store builds must be tracked before applying fixes.

Game data: Configuration file(s) location uses the Windows Documents folder,
while Linux/Proton testing uses Steam compatdata and XDG paths.

Video: ultrawide, FOV, HDR, VSync, frame rate, stutter, and FPS drops need
per-runtime validation because Direct3D 11, Vulkan, DXVK, and VKD3D behave
differently.

Input, Audio, Network, and VR support are separate fix lanes. Controller prompts,
microphone gain, TCP/UDP ports, co-op connectivity, OpenXR, and OpenVR should not
be hidden inside graphics notes.

Issues fixed: crash at startup, frame rate is not smooth, and game does not use
the full VRAM budget. Each workaround needs a rollback path.
