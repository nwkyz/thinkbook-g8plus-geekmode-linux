<p align="center">Enable Extreme Mode on the ThinkBook G8+ IPD (16+ 2026 / 21VJ) under Linux</p>

<p align="center">[ <a href="readme.md">中文</a> / English ]</p>

> [!NOTE]
> The English version of README is translated from Chinese by AI

## Introduction

Patches `ideapad-laptop` to expose Lenovo's "Extreme Mode" as the platform_profile
`max-power`, and provides a manual toggle.

**Known compatible:**
- **Device:** Lenovo ThinkBook 16+ 2026 (dGPU) 356H+5060 (G8+ IPD / `21VJ` ), BIOS `TRCN21WW`
- **System:** Ubuntu 26.04 @ Linux 7.0.0-31-generic

> [!NOTE]
> This device (356H) has an Intel `SoC Power Slider` provider, and the legacy
> `/sys/firmware/acpi/platform_profile` only exposes the **intersection** of all
> providers, so `max-power` is not visible there. The `geek` script writes the
> ideapad **class device** `/sys/class/platform-profile/platform-profile-N/profile`
> directly, without touching the SoC slider.

> [!WARNING]
> This is not an official Lenovo project.

## Quick Start

Tested on Ubuntu 26.04.

### 0. Dependencies

```bash
sudo apt install dkms linux-headers-$(uname -r)
# Secure Boot must be disabled
```
> [!WARNING]
> Secure Boot must be disabled.

### 1. Install

```bash
make clean                                   # drop prebuilt artifacts so DKMS rebuilds

sudo dkms add .
sudo dkms build thinkbook-21vj-geek/1.0
sudo dkms install thinkbook-21vj-geek/1.0
sudo depmod -a
sudo update-initramfs -u                     # optional, for safety

sudo modprobe -r ideapad_laptop              # switch to the patched module
sudo modprobe ideapad_laptop

sudo install -m 0755 geek /usr/local/bin/geek
```

### 2. Verify

```bash
# is the patch active: max-power should appear in the ideapad choices
for d in /sys/class/platform-profile/platform-profile-*; do
    echo "$(cat "$d/name"): $(cat "$d/choices")"
done
# expected: ideapad-laptop: low-power balanced performance max-power

geek status
```

### 3. Usage

> [!WARNING]
> **About the power adapter**: a 245W or higher official adapter is strongly
> recommended; Extreme Mode is usable with a 170W or higher adapter, but enabling
> it in that state is not recommended.

```bash
geek on          # Extreme Mode, 170W
geek status      # show status
geek off         # back to normal (up to 150W)
```

### 4. Uninstall

```bash
sudo rm -f /usr/local/bin/geek
sudo dkms remove thinkbook-21vj-geek/1.0 --all
sudo modprobe -r ideapad_laptop && sudo modprobe ideapad_laptop
sudo update-initramfs -u
```

After uninstalling, the in-tree `ideapad-laptop` is used again and behaves exactly
as before this patch.

### 5. Upgrade

Just uninstall and reinstall.

## GNOME Quick Settings toggle (optional)

Prerequisite: `/usr/local/bin/geek` is installed (see "Quick Start").

```bash
cd ~/Documents/projects3/probe/probe_extrememode/thinkbook-21vj-geek

# 1) polkit rule: let the active local user run pkexec on /usr/local/bin/geek without a password
sudo install -m 0644 polkit/49-thinkbook-geek.rules /etc/polkit-1/rules.d/

# 2) install the extension
mkdir -p ~/.local/share/gnome-shell/extensions
rm -rf ~/.local/share/gnome-shell/extensions/thinkbook-g8plus-geekmode@nwkyz
cp -r gnome-extension/thinkbook-g8plus-geekmode@nwkyz ~/.local/share/gnome-shell/extensions/

# 3) enable (on Wayland this takes effect only after a log out / log in)
gnome-extensions enable thinkbook-g8plus-geekmode@nwkyz
```

After logging in, when 170W+ adapter is connected, an Extreme Mode
button appears in the GNOME Quick Settings panel.

Uninstall the extension:

```bash
gnome-extensions disable thinkbook-g8plus-geekmode@nwkyz
rm -rf ~/.local/share/gnome-shell/extensions/thinkbook-g8plus-geekmode@nwkyz
sudo rm -f /etc/polkit-1/rules.d/49-thinkbook-geek.rules
```

## Notes

> [!WARNING]
> **About the power adapter**: a 245W or higher official adapter is strongly
> recommended; Extreme Mode is usable with a 170W or higher adapter, but enabling
> it in that state is not recommended.

1. **The GNOME power menu still only has three modes**: PPD's D-Bus API and the
   GNOME integration both hardcode three modes, so Extreme Mode cannot appear in
   the native menu; use the `geek` command or the GNOME extension toggle.
2. **About overclocking**: under Windows, Lenovo Baiying applies a default GPU core
   overclock of +200 MHz and a memory overclock of +300 MHz in Extreme Mode, but
   this project does not perform any overclocking.
3. **It writes the EC, but reversibly**: the Extreme sequence = `ECCC(0x60,0xA7)` +
   `GKMF=1` + `ECCC(0x60,0xA5)`, identical to firmware `_Q2B`; `geek off`, switching
   to a standard profile, unplugging, or unloading the module all clear it.
4. **Thermals**: 170W is only recommended with the original 245W adapter and good
   cooling; watch the temperatures.
5. **DMI gating**: for safety the patch only enables `max-power` on
   `LENOVO / 21VJ / LNVNB161216`.
6. **Does not modify** `processor_thermal_soc_slider`, PPD, or GNOME.
7. **`geek on` does not depend on PPD's current profile**: the patch **first** sets
   the standard profile to performance (MMC), **then** enables Extreme Mode on top.
   So even if PPD is currently balanced/power-saver, in theory `geek on` still
   reaches the full 170W. To go back to normal use `geek off` (returns to performance).
8. **`geek on` also switches PPD to performance** (`powerprofilesctl set performance`,
   best-effort): this makes GNOME show "Performance" and raises the **CPU EPP to
   performance** as well. The order is PPD first, then Extreme Mode (the other way
   round it would be cleared by PPD's legacy write).

## FAQ

**Q: `scaling_governor` is always `powersave` — am I being throttled?**

No. The Intel `intel_pstate` driver only has two governors, `powersave` /
`performance`, and the default is **`powersave`** — it is **not** "low performance";
frequency is scaled dynamically by the hardware (HWP) and still ramps up under load.
The real performance bias is set by **EPP** (`energy_performance_preference`), which
is what PPD adjusts. So seeing `powersave` is normal and needs no change; `geek on`
raising EPP to performance via PPD is what matters.

## How it works

After `geek on` the chain is:

```
sysfs class device (platform-profile-N/profile = max-power)
        │
        ▼
ideapad-laptop patch  dytc_profile_set(MAX_POWER)
        │  AC check
        │  1) first send MMC performance (ensure the CPU is in the performance profile)
        │  2) then send DYTC SET_EXT 0x001F100B (enable Extreme Mode on top)
        ▼
ACPI Method(DYTC)  → FFSP=1 / GKMF=1 / OD18=1, switch to the high-power table (ATPP +20W)
        ▼
whole system 150W → 170W
```

- Query: `DYTC GET_EXT 0x0000000C`, bit16 = whether Extreme Mode is active;
- Switching to a standard profile clears FFSP automatically (firmware behavior);
- Unplugging: the `power_supply` notifier clears Extreme Mode and returns to performance;
- Unloading the module: forces Extreme Mode off.

## Files

| File | Purpose |
|---|---|
| `ideapad-laptop.c` | patched driver source (DMI gating + `max-power` + SET_EXT/GET_EXT + AC fallback) |
| `Makefile` | external module build |
| `dkms.conf` | DKMS config (package `thinkbook-21vj-geek/1.0`) |
| `geek` | manual toggle script (`on` / `off` / `status`) |
| `gnome-extension/thinkbook-g8plus-geekmode@nwkyz/` | GNOME Shell Quick Settings toggle extension |
| `polkit/49-thinkbook-geek.rules` | polkit rule allowing passwordless `pkexec /usr/local/bin/geek` |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `geek: ideapad-laptop platform_profile not found` | patched module not loaded; `lsmod \| grep ideapad_laptop`, then `dkms install` and `modprobe -r/-a` again |
| `max-power` missing from choices | the in-tree stock module is loaded (DKMS not active) or DMI did not match |
| `geek: refusing, not on AC power` | not on AC; this is the normal protection |
| DKMS build fails | run `make clean` first; make sure `linux-headers-$(uname -r)` is installed |
| After plugging in, `geek status` shows it reverted to performance | PPD changed the profile and cleared Extreme Mode; just run `sudo geek on` again (expected behavior) |

## License

Released under **GPL-2.0-or-later** (see `LICENSE`). `ideapad-laptop.c` /
`ideapad-laptop.h` are derived from the Linux kernel source and retain the
original copyright and SPDX identifiers

## References
[111inhistory/thinkbook-16-g6-plus-linux](https://github.com/111inhistory/thinkbook-16-g6-plus-linux)
