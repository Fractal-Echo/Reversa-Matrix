const COMMON_REPORT_SECTIONS = [
  'executive_summary',
  'high_confidence_findings',
  'contradictions',
  'path_problems',
  'placeholders',
  'patch_candidates',
  'evidence_table',
  'known_good_comparison',
  'file_inventory',
  'risk_map',
  'validation_checklist',
  'agent_handoff',
];

const ANDROID_RECOVERY_PATTERNS = [
  /(^|\/)BoardConfig.*\.mk$/i,
  /(^|\/)AndroidProducts\.mk$/i,
  /(^|\/)device[^/]*\.mk$/i,
  /(^|\/)product[^/]*\.mk$/i,
  /(^|\/)orangefox_.*\.mk$/i,
  /(^|\/)twrp_.*\.mk$/i,
  /(^|\/)recovery\/root\/.*\.rc$/i,
  /(^|\/)root\/.*\.rc$/i,
  /(^|\/).*fstab.*$/i,
  /(^|\/).*key(master|mint).*$/i,
  /(^|\/).*gatekeeper.*$/i,
  /(^|\/).*decrypt.*$/i,
  /(^|\/).*touch.*$/i,
  /(^|\/).*display.*$/i,
  /(^|\/).*theme.*$/i,
  /(^|\/)vendor-files.*\.txt$/i,
  /(^|\/)proprietary-files.*\.txt$/i,
  /(^|\/)extract-files.*\.sh$/i,
];

const ANDROID_RECOVERY_REQUIRED_PATTERNS = [
  /(^|\/)BoardConfig.*\.mk$/i,
  /(^|\/)AndroidProducts\.mk$/i,
  /(^|\/).*fstab.*$/i,
];

const ANDROID_RECOVERY_VARIABLES = [
  'TARGET_BOARD_PLATFORM',
  'PRODUCT_PLATFORM',
  'PRODUCT_DEVICE',
  'PRODUCT_MODEL',
  'PRODUCT_NAME',
  'TARGET_DEVICE',
  'TARGET_OTA_ASSERT_DEVICE',
  'TARGET_BOOTLOADER_BOARD_NAME',
  'TARGET_RECOVERY_PIXEL_FORMAT',
  'BOARD_BOOT_HEADER_VERSION',
  'BOARD_EXCLUDE_KERNEL_FROM_RECOVERY_IMAGE',
  'BOARD_KERNEL_CMDLINE',
  'BOARD_KERNEL_BASE',
  'BOARD_KERNEL_PAGESIZE',
  'BOARD_MKBOOTIMG_ARGS',
  'BOARD_BOOTIMAGE_PARTITION_SIZE',
  'BOARD_INIT_BOOT_IMAGE_PARTITION_SIZE',
  'BOARD_RECOVERYIMAGE_PARTITION_SIZE',
  'BOARD_VENDOR_BOOTIMAGE_PARTITION_SIZE',
  'TARGET_RECOVERY_FSTAB',
  'TW_THEME',
  'OF_SCREEN_H',
  'OF_SCREEN_W',
  'OF_TOUCH_*',
  'TW_INCLUDE_CRYPTO',
  'TW_INCLUDE_CRYPTO_FBE',
  'PRODUCT_COPY_FILES',
];

const ANDROID_VALIDATION_COMMANDS = [
  'find {{projectRoot}} -name BoardConfig.mk -o -name AndroidProducts.mk -o -name "*fstab*"',
  'grep -RIn "TARGET_BOARD_PLATFORM\\|PRODUCT_PLATFORM\\|PRODUCT_DEVICE\\|BOARD_RECOVERYIMAGE_PARTITION_SIZE\\|BOARD_BOOT_HEADER_VERSION" {{projectRoot}}',
  'grep -RIn "keymaster\\|keymint\\|gatekeeper\\|decrypt\\|vbmeta\\|avb\\|fstab" {{projectRoot}}',
];

export const PROFILES = {
  generic_source_tree: {
    id: 'generic_source_tree',
    label: 'Generic source tree',
    importantFilePatterns: [
      /(^|\/)README(\..*)?$/i,
      /(^|\/)package\.json$/i,
      /(^|\/)Makefile$/i,
      /(^|\/).*\.mk$/i,
      /(^|\/).*\.toml$/i,
      /(^|\/).*\.ya?ml$/i,
      /(^|\/).*\.json$/i,
    ],
    requiredFilePatterns: [],
    importantVariables: [],
    riskyLeftovers: ['sample', 'example', 'template', 'dummy', 'fake', 'placeholder'],
    expectedDirectoryPatterns: [],
    commonContradictions: [
      'duplicated definitions with different values',
      'referenced paths not present in the scanned tree',
      'TODO/FIXME markers in important files',
    ],
    validationCommands: [
      'find {{projectRoot}} -maxdepth 3 -type f | sort | head -200',
      'grep -RIn "TODO\\|FIXME\\|PLACEHOLDER\\|STUB" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  android_recovery: {
    id: 'android_recovery',
    label: 'Android recovery device tree',
    importantFilePatterns: ANDROID_RECOVERY_PATTERNS,
    requiredFilePatterns: ANDROID_RECOVERY_REQUIRED_PATTERNS,
    importantVariables: ANDROID_RECOVERY_VARIABLES,
    riskyLeftovers: [
      'RM10Pro',
      'RM10',
      'sm8750',
      'kalama',
      'lahaina',
      'kona',
      'taro',
      'pineapple',
      'waipio',
      'TODO',
      'FIXME',
      'PLACEHOLDER',
      'STUB',
    ],
    expectedDirectoryPatterns: [
      /(^|\/)recovery\/root(\/|$)/i,
      /(^|\/)vendor(\/|$)/i,
      /(^|\/)proprietary(\/|$)/i,
    ],
    commonContradictions: [
      'TARGET_BOARD_PLATFORM mismatch',
      'PRODUCT_PLATFORM mismatch',
      'codename mismatch',
      'partition size mismatch',
      'recovery image size mismatch',
      'boot header version mismatch',
      'wrong SoC family leftovers',
      'init rc service binary missing',
      'fstab references partition or mount options not supported by known-good facts',
      'AVB/vbmeta assumptions conflict with observed device facts',
    ],
    validationCommands: ANDROID_VALIDATION_COMMANDS,
    reportSections: COMMON_REPORT_SECTIONS,
  },
  orangefox: {
    id: 'orangefox',
    label: 'OrangeFox recovery tree',
    extends: 'android_recovery',
    importantFilePatterns: [
      ...ANDROID_RECOVERY_PATTERNS,
      /(^|\/).*orangefox.*$/i,
      /(^|\/)vendorsetup\.sh$/i,
    ],
    importantVariables: [
      ...ANDROID_RECOVERY_VARIABLES,
      'FOX_*',
      'OF_*',
      'TW_*',
    ],
    riskyLeftovers: ['twrp-only', 'oldfox', 'RM10Pro', 'sm8750', 'template', 'placeholder'],
    validationCommands: [
      ...ANDROID_VALIDATION_COMMANDS,
      'grep -RIn "FOX_\\|OF_\\|TW_" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  twrp: {
    id: 'twrp',
    label: 'TWRP recovery tree',
    extends: 'android_recovery',
    importantFilePatterns: ANDROID_RECOVERY_PATTERNS,
    importantVariables: [
      ...ANDROID_RECOVERY_VARIABLES,
      'TW_*',
    ],
    riskyLeftovers: ['orangefox-only', 'RM10Pro', 'sm8750', 'template', 'placeholder'],
    validationCommands: [
      ...ANDROID_VALIDATION_COMMANDS,
      'grep -RIn "TW_" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  android_kernel: {
    id: 'android_kernel',
    label: 'Android kernel tree',
    importantFilePatterns: [
      /(^|\/)Makefile$/i,
      /(^|\/)Kconfig$/i,
      /(^|\/)arch\/arm64\/configs\/.*defconfig$/i,
      /(^|\/)arch\/arm64\/boot\/dts\/.*\.dtsi?$/i,
    ],
    importantVariables: ['CONFIG_*', 'ARCH', 'CROSS_COMPILE', 'KERNELRELEASE'],
    riskyLeftovers: ['TODO', 'FIXME', 'PLACEHOLDER', 'STUB', 'deprecated'],
    expectedDirectoryPatterns: [/^arch\/arm64\//i, /^drivers\//i],
    commonContradictions: [
      'defconfig enables feature but driver path is absent',
      'DTS compatible strings conflict with target SoC',
    ],
    validationCommands: [
      'find {{projectRoot}} -path "*/arch/arm64/configs/*defconfig" -o -path "*/arch/arm64/boot/dts/*"',
      'grep -RIn "CONFIG_\\|compatible =" {{projectRoot}}/arch {{projectRoot}}/drivers',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  gki_kernel: {
    id: 'gki_kernel',
    label: 'GKI kernel tree',
    extends: 'android_kernel',
    importantFilePatterns: [
      /(^|\/)BUILD\.bazel$/i,
      /(^|\/)build\.config.*$/i,
      /(^|\/)common\/.*$/i,
      /(^|\/)modules\.load.*$/i,
    ],
    importantVariables: ['CONFIG_*', 'KMI_*', 'ABI_*'],
    riskyLeftovers: ['non-gki', 'vendor hack', 'TODO', 'FIXME'],
    validationCommands: [
      'find {{projectRoot}} -name "build.config*" -o -name "modules.load*" -o -name "abi_*"',
      'grep -RIn "KMI\\|ABI\\|CONFIG_" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  userspace_graphics: {
    id: 'userspace_graphics',
    label: 'Userspace graphics stack',
    importantFilePatterns: [
      /(^|\/)meson\.build$/i,
      /(^|\/)CMakeLists\.txt$/i,
      /(^|\/).*wayland.*$/i,
      /(^|\/).*xwayland.*$/i,
      /(^|\/).*glx.*$/i,
      /(^|\/).*egl.*$/i,
      /(^|\/).*vulkan.*$/i,
      /(^|\/).*drm.*$/i,
    ],
    importantVariables: ['LD_LIBRARY_PATH', 'VK_*', 'MESA_*', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR'],
    riskyLeftovers: ['llvmpipe', 'swrast', 'software', 'stub', 'placeholder'],
    expectedDirectoryPatterns: [],
    commonContradictions: [
      'GLX/EGL configuration references libraries not present',
      'Wayland socket variables disagree across launch scripts',
      'software renderer fallback present in hardware-rendering lane',
    ],
    validationCommands: [
      'grep -RIn "GLX\\|EGL\\|Vulkan\\|VK_\\|LD_LIBRARY_PATH\\|WAYLAND_DISPLAY\\|DISPLAY" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  linux_container: {
    id: 'linux_container',
    label: 'Linux container runtime',
    importantFilePatterns: [
      /(^|\/)Dockerfile$/i,
      /(^|\/).*container.*$/i,
      /(^|\/).*rootfs.*$/i,
      /(^|\/).*chroot.*$/i,
      /(^|\/).*proot.*$/i,
      /(^|\/).*systemd.*$/i,
    ],
    importantVariables: ['PATH', 'LD_LIBRARY_PATH', 'HOME', 'USER', 'XDG_RUNTIME_DIR'],
    riskyLeftovers: ['host-only', 'placeholder', 'fake', 'stub'],
    expectedDirectoryPatterns: [],
    commonContradictions: [
      'host path leaked into container config',
      'rootfs path referenced but absent',
      'service binary referenced but absent',
    ],
    validationCommands: [
      'grep -RIn "rootfs\\|chroot\\|proot\\|LD_LIBRARY_PATH\\|XDG_RUNTIME_DIR" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
  gamescope: {
    id: 'gamescope',
    label: 'Gamescope / wlroots graphics stack',
    extends: 'userspace_graphics',
    importantFilePatterns: [
      /(^|\/).*gamescope.*$/i,
      /(^|\/).*wlroots.*$/i,
      /(^|\/).*xwayland.*$/i,
      /(^|\/).*wayland.*$/i,
      /(^|\/).*drm.*$/i,
      /(^|\/).*xkb.*$/i,
    ],
    importantVariables: ['GAMESCOPE_*', 'WAYLAND_DISPLAY', 'DISPLAY', 'XWAYLAND_*', 'XKB_*', 'LD_LIBRARY_PATH'],
    riskyLeftovers: ['swrast', 'llvmpipe', 'placeholder', 'stub', 'drm lease'],
    validationCommands: [
      'grep -RIn "gamescope\\|wlroots\\|Xwayland\\|GLX\\|xkb\\|WAYLAND_DISPLAY\\|DISPLAY" {{projectRoot}}',
    ],
    reportSections: COMMON_REPORT_SECTIONS,
  },
};

export function getProfile(profileId = 'generic_source_tree') {
  const profile = PROFILES[profileId];
  if (!profile) {
    const known = Object.keys(PROFILES).sort().join(', ');
    throw new Error(`Unknown scan profile "${profileId}". Known profiles: ${known}`);
  }

  if (!profile.extends) {
    return profile;
  }

  return {
    ...PROFILES[profile.extends],
    ...profile,
    importantFilePatterns: profile.importantFilePatterns ?? PROFILES[profile.extends].importantFilePatterns,
    requiredFilePatterns: profile.requiredFilePatterns ?? PROFILES[profile.extends].requiredFilePatterns,
    importantVariables: profile.importantVariables ?? PROFILES[profile.extends].importantVariables,
    riskyLeftovers: profile.riskyLeftovers ?? PROFILES[profile.extends].riskyLeftovers,
    validationCommands: profile.validationCommands ?? PROFILES[profile.extends].validationCommands,
    reportSections: profile.reportSections ?? PROFILES[profile.extends].reportSections,
  };
}

export function listProfiles() {
  return Object.values(PROFILES).map(profile => ({
    id: profile.id,
    label: profile.label,
  }));
}
