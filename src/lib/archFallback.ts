// Architecture-mismatch detection for the Podman → Docker fallback.
//
// On Apple Silicon a Podman machine is an arm64 VM, so amd64-only images
// either fail to pull ("no image found in image index for architecture …")
// or start and die with "exec format error". Docker Desktop / OrbStack can
// run those images under Rosetta / QEMU when asked for the foreign platform.

const MISMATCH_PATTERNS = [
  /no image found in (image index|manifest list) for architecture/i,
  /no matching manifest for/i,
  /does not match the (expected|detected host) platform/i,
  /exec format error/i,
];

/** True when a CLI error looks like an image / host CPU architecture mismatch. */
export function isArchMismatch(message: string): boolean {
  return MISMATCH_PATTERNS.some((re) => re.test(message));
}

/** The foreign platform to request from Docker on this host: images that won't
 *  run natively on arm64 are amd64, and vice versa. */
export function fallbackPlatform(hostArch: string): string {
  return /arm64|aarch64/i.test(hostArch) ? 'linux/amd64' : 'linux/arm64';
}
