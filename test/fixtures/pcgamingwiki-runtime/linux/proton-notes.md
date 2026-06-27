# Linux / Proton Notes

Steam Deck and Linux testing use Proton, Wine, DXVK, VKD3D, Gamescope,
MangoHud, gamemoderun, and a Wine prefix under compatdata/311210.

Use `PROTON_LOG=1`, `WINEPREFIX`, `WINEDLLOVERRIDES`, and `VK_ICD_FILENAMES`
only inside the selected compatibility profile.

XDG support matters: `XDG_DATA_HOME` and `XDG_CONFIG_HOME` should not be mixed
with native Windows AppData paths.
