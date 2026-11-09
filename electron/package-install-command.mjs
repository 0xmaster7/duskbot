const BUILDERS = {
  // apt-get, never `dpkg -i`: only apt-get resolves dependencies, and Ubuntu satisfies ours through virtual Provides.
  deb: (file) => `sudo apt-get install -y ${file}`,
  rpm: (file) => `sudo rpm -Uvh ${file}`,
  pacman: (file) => `sudo pacman -U ${file}`,
};

export const HAND_OFF_PACKAGE_TYPES = Object.freeze(Object.keys(BUILDERS));

export function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function packageInstallCommand(packageType, file) {
  const build = Object.hasOwn(BUILDERS, packageType) ? BUILDERS[packageType] : undefined;
  if (!build) throw new Error(`No install command for package type ${JSON.stringify(packageType)}`);
  if (typeof file !== "string" || file.length === 0) {
    throw new Error("The downloaded package is no longer available. Download the package again.");
  }
  return build(shellQuote(file));
}
