<p align="center">在Linux上启用 ThinkBook 16+ 2026 (G8+ IPD / 21VJ) 的极客模式</p>  

<p align="center">[ 中文 / <a href="readme_en.md">English</a> ]</p>

## 简介

给 `ideapad-laptop` 打补丁，把 Lenovo「极客/Extreme 模式」暴露为 platform_profile 的 `max-power`，并提供手动开关。

**已知兼容:**
- **设备**：Lenovo ThinkBook 16+ 2026 独显版 356H+5060 ( G8+ IPD / `21VJ` )，BIOS `TRCN21WW`
- **系统**：Ubuntu 26.04 @ Linux 7.0.0-31-generic

> [!NOTE]
> 本设备356H处理器具有 Intel `SoC Power Slider` provider，legacy `/sys/firmware/acpi/platform_profile` 只暴露各 provider 的**交集**，因此`max-power` 不可见。`geek` 脚本直接写 ideapad 的**类设备** `/sys/class/platform-profile/platform-profile-N/profile`，不改动 SoC slider。

> [!WARNING]
> 本项目不是联想官方项目

## 快速开始

已经在Ubuntu26.04经过测试

### 0. 依赖

```bash
sudo apt install dkms linux-headers-$(uname -r)
# 需要关闭安全启动
```
> [!WARNING]
> 需要关闭安全启动

### 1. 安装

```bash
make clean                                   # 清掉预编译产物，确保 DKMS 重新编译

sudo dkms add .
sudo dkms build thinkbook-21vj-geek/1.0
sudo dkms install thinkbook-21vj-geek/1.0
sudo depmod -a
sudo update-initramfs -u                     # 可选，稳妥

sudo modprobe -r ideapad_laptop              # 换成补丁模块
sudo modprobe ideapad_laptop

sudo install -m 0755 geek /usr/local/bin/geek
```

### 2. 验证

```bash
# 补丁模块是否生效：ideapad 的 choices 里应出现 max-power
for d in /sys/class/platform-profile/platform-profile-*; do
    echo "$(cat "$d/name"): $(cat "$d/choices")"
done
# 期望：ideapad-laptop: low-power balanced performance max-power

geek status
```

### 3. 使用

> [!WARNING]
> **有关电源适配器**：强烈建议使用245W或245W以上的原装电源适配器;使用170W及以上的适配器时极客模式可用，但不推荐在这种状态下开启

```bash
geek on          # 极客 170W
geek status      # 查看状态
geek off         # 回到普通 （至高150W）
```

### 4. 卸载

```bash
sudo rm -f /usr/local/bin/geek
sudo dkms remove thinkbook-21vj-geek/1.0 --all
sudo modprobe -r ideapad_laptop && sudo modprobe ideapad_laptop
sudo update-initramfs -u
```

卸载后将使用内核自带 `ideapad-laptop`，行为与本补丁前完全一致。

### 5. 升级

卸载再安装就得了


## GNOME 快速设置开关（可选）

确保前置：`/usr/local/bin/geek` 已安装（见 "快速开始"）。

```bash
cd ~/Documents/projects3/probe/probe_extrememode/thinkbook-21vj-geek

# 1) polkit 规则：允许当前本地活动用户免密 pkexec 调用 /usr/local/bin/geek
sudo install -m 0644 polkit/49-thinkbook-geek.rules /etc/polkit-1/rules.d/

# 2) 安装扩展
mkdir -p ~/.local/share/gnome-shell/extensions
rm -rf ~/.local/share/gnome-shell/extensions/thinkbook-g8plus-geekmode@nwkyz
cp -r gnome-extension/thinkbook-g8plus-geekmode@nwkyz ~/.local/share/gnome-shell/extensions/

# 3) 启用（Wayland 下需要注销/重新登录后生效）
gnome-extensions enable thinkbook-g8plus-geekmode@nwkyz
```

登录后，在接入170W+适配器时，GNOME快速设置面板会出现极客模式按钮

卸载扩展：

```bash
gnome-extensions disable thinkbook-g8plus-geekmode@nwkyz
rm -rf ~/.local/share/gnome-shell/extensions/thinkbook-g8plus-geekmode@nwkyz
sudo rm -f /etc/polkit-1/rules.d/49-thinkbook-geek.rules
```

## 注意事项

> [!WARNING]
> **有关电源适配器**：强烈建议使用245W或245W以上的原装电源适配器;使用170W及以上的适配器时极客模式可用，但不推荐在这种状态下开启

1. **GNOME 电源菜单仍只有三档**：PPD 的 D-Bus 与 GNOME 集成都写死三档，极客进不了原生菜单；
   请使用`geek`命令或GNOME扩展开关。
2. **关于超频**: Windows下，联想百应内极客模式下默认GPU核心超频200MHz，显存超频300MHz，但本项目没有执行任何超频操作。
3. **写 EC 但可逆**：极客序列 = `ECCC(0x60,0xA7)` + `GKMF=1` + `ECCC(0x60,0xA5)`，与固件
   `_Q2B` 相同；`geek off`、切标准档、掉电、卸载都会清除。
4. **散热**：170W 仅推荐在原装 245W 适配器、良好散热下使用，注意温度。
5. **DMI 门控**：为保证安全，补丁仅在 `LENOVO / 21VJ / LNVNB161216` 上启用 `max-power`。
6. **不修改** `processor_thermal_soc_slider`、不修改 PPD、不修改 GNOME。
7. **`geek on` 不依赖 PPD 当前档位**：补丁会**先**把标准档设为 performance（MMC），**再**在同档之上开极客。
   因此即使 PPD 此刻是 balanced/省电，理论上，`geek on` 也能得到完整的 170W。切回普通档则用 `geek off`（回到 performance）。
8. **`geek on` 会顺手把 PPD 切到 performance**（`powerprofilesctl set performance`，best-effort）：
   这样 GNOME 显示为「性能」，同时把 **CPU EPP 也提到 performance**，与极客配套。
   顺序是先切 PPD、再开极客（反了会被 PPD 的 legacy 写入清掉）。


## 常见疑问

**Q：`scaling_governor` 一直是 `powersave`，是不是被限速了？**

不是。Intel `intel_pstate` 驱动只有 `powersave` / `performance` 两个 governor，默认就是
**`powersave`**——它**不是**“低性能”，而是由硬件 HWP 动态调频，负载上来照样升频。真正的
性能倾向由 **EPP**（`energy_performance_preference`）决定，这也是 PPD 在调的。
所以看到 `powersave` 属正常，不用改；`geek on` 通过 PPD 把 EPP 设到 performance 才是关键。

## 原理简述

`geek on` 后链路如下：

```
sysfs class device (platform-profile-N/profile = max-power)
        │
        ▼
ideapad-laptop 补丁  dytc_profile_set(MAX_POWER)
        │  AC 检查
        │  ① 先发 MMC performance（确保 CPU 处于性能档）
        │  ② 再发 DYTC SET_EXT 0x001F100B（在同档之上开极客）
        ▼
ACPI Method(DYTC)  → FFSP=1 / GKMF=1 / OD18=1，切换高功率表（ATPP +20W）
        ▼
整机 150W → 170W
```

- 查询：`DYTC GET_EXT 0x0000000C`，bit16 = 是否极客；
- 切标准档会自动清 FFSP（固件行为）；
- 掉电：`power_supply` 通知链清极客并回 performance；
- 卸载模块：强制清极客。

## 文件说明

| 文件 | 作用 |
|---|---|
| `ideapad-laptop.c` | 打过补丁的驱动源码（DMI 门控 + `max-power` + SET_EXT/GET_EXT + AC 回退） |
| `Makefile` | 外部模块构建 |
| `dkms.conf` | DKMS 配置（包名 `thinkbook-21vj-geek/1.0`） |
| `geek` | 手动开关脚本（`on` / `off` / `status`） |
| `gnome-extension/thinkbook-g8plus-geekmode@nwkyz/` | GNOME Shell Quick Settings 开关扩展 |
| `polkit/49-thinkbook-geek.rules` | 允许免密 `pkexec /usr/local/bin/geek` 的 polkit 规则 |

## 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| `geek: ideapad-laptop platform_profile not found` | 补丁模块未加载；`lsmod \| grep ideapad_laptop`，重新 `dkms install` 并 `modprobe -r/-a` |
| choices 里没有 `max-power` | 加载的是内核原版模块（DKMS 未生效）或 DMI 未命中 |
| `geek: refusing, not on AC power` | 未插电，属正常保护 |
| DKMS 编译失败 | 先 `make clean`；确认 `linux-headers-$(uname -r)` 已安装 |
| 插电后 `geek status` 显示自动变回 performance | PPD 改档清了极客，重新 `sudo geek on` 即可（预期行为） |

## 许可证

本项目以 **GPL-2.0-or-later** 发布（见 `LICENSE`）。其中 `ideapad-laptop.c` /
`ideapad-laptop.h` 派生自 Linux 内核源码，保留原始版权与 SPDX 标识

## 参考
[111inhistory/thinkbook-16-g6-plus-linux](https://github.com/111inhistory/thinkbook-16-g6-plus-linux)