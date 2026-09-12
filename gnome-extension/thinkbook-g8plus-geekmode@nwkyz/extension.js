// SPDX-License-Identifier: GPL-2.0-or-later
//
// GNOME Shell Quick Settings toggle for ThinkBook 16 G8+ IPD (21VJ)
// Extreme/Geek mode.
//
// Reads the ideapad-laptop platform_profile class device to show state, and
// toggles it through `pkexec /usr/local/bin/geek on|off` (a polkit rule makes
// that passwordless for the active local user).
//
// The toggle is only shown when Geek can actually be enabled:
//   - the patched ideapad-laptop provider exposes "max-power",
//   - the system is on AC power, and
//   - the firmware adapter budget is >= 170 W.
//
// When enabling with an adapter budget >= 170 W but < 245 W, a desktop
// notification recommends a 245 W+ official adapter.
//
// Label follows the session language: Chinese "极客模式", otherwise
// "Extreme Mode". Author: nwkyz.

import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const PROFILE_DIR = '/sys/class/platform-profile';
const POWER_DIR = '/sys/class/power_supply';
const PLATFORM_DEV_DIR = '/sys/bus/platform/devices';
const DPTF_DIR = '/sys/devices/platform';
const GEEK_HELPER = '/usr/local/bin/geek';
const WARN_FLAG = GLib.build_filenamev([GLib.get_user_config_dir(),
                                        'thinkbook-g8plus-geekmode',
                                        'no-adapter-warning']);

const MIN_ADAPTER_WATTS = 170;
const RECOMMEND_ADAPTER_WATTS = 245;

function tr(english, chinese) {
    for (const lang of GLib.get_language_names()) {
        if (lang.startsWith('zh'))
            return chinese;
    }
    return english;
}

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return new TextDecoder().decode(bytes).trim();
    } catch (e) {
        return null;
    }
}

function ideapadProfilePath() {
    let enumerator;
    try {
        const dir = Gio.File.new_for_path(PROFILE_DIR);
        enumerator = dir.enumerate_children('standard::name',
                                            Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        return null;
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const base = `${PROFILE_DIR}/${info.get_name()}`;
        if (readFile(`${base}/name`) === 'ideapad-laptop')
            return `${base}/profile`;
    }
    return null;
}

function geekSupported() {
    const profile = ideapadProfilePath();
    if (profile === null)
        return false;
    const choices = readFile(profile.replace(/\/profile$/, '/choices'));
    return choices !== null && choices.split(/\s+/).includes('max-power');
}

function onAcPower() {
    let enumerator;
    try {
        const dir = Gio.File.new_for_path(POWER_DIR);
        enumerator = dir.enumerate_children('standard::name',
                                            Gio.FileQueryInfoFlags.NONE, null);
    } catch (e) {
        return false;
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const base = `${POWER_DIR}/${info.get_name()}`;
        if (readFile(`${base}/type`) === 'Mains' && readFile(`${base}/online`) === '1')
            return true;
    }
    return false;
}

function isGeekOn() {
    const profile = ideapadProfilePath();
    return profile !== null && readFile(profile) === 'max-power';
}

// Firmware-reported adapter budget in watts. Prefers the patched module's
// firmware_adapter_watts attribute, falls back to the DPTF sysfs. The found
// source is cached so the 3 s poll does not rescan every time.
let adapterSource = null; // { path, scale }

function scanAdapterSource() {
    // 1) patched module attribute, already in watts
    try {
        const dir = Gio.File.new_for_path(PLATFORM_DEV_DIR);
        const e = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = e.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.startsWith('VPC2004'))
                continue;
            const path = `${PLATFORM_DEV_DIR}/${name}/firmware_adapter_watts`;
            if (readFile(path) !== null)
                return { path, scale: 1 };
        }
    } catch (e) {
        // ignore
    }

    // 2) DPTF fallback: /sys/devices/platform/*/*/dptf_power/adapter_rating_mw (mW)
    try {
        const base = Gio.File.new_for_path(DPTF_DIR);
        const e1 = base.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let i1;
        while ((i1 = e1.next_file(null)) !== null) {
            const p1 = `${DPTF_DIR}/${i1.get_name()}`;
            let e2;
            try {
                e2 = Gio.File.new_for_path(p1).enumerate_children('standard::name',
                                                                  Gio.FileQueryInfoFlags.NONE, null);
            } catch (e) {
                continue;
            }
            let i2;
            while ((i2 = e2.next_file(null)) !== null) {
                const path = `${p1}/${i2.get_name()}/dptf_power/adapter_rating_mw`;
                if (readFile(path) !== null)
                    return { path, scale: 1 / 1000 };
            }
        }
    } catch (e) {
        // ignore
    }

    return null;
}

function adapterWatts() {
    if (adapterSource !== null) {
        const raw = readFile(adapterSource.path);
        const val = raw === null ? NaN : parseInt(raw, 10);
        if (!Number.isNaN(val))
            return Math.round(val * adapterSource.scale);
        adapterSource = null;
    }

    const src = scanAdapterSource();
    if (src === null)
        return null;

    const raw = readFile(src.path);
    const val = raw === null ? NaN : parseInt(raw, 10);
    if (Number.isNaN(val))
        return null;

    adapterSource = src;
    return Math.round(val * src.scale);
}

// Unknown budget -> assume qualified; known but < 170 W -> not qualified.
function adapterQualified() {
    const watts = adapterWatts();
    return watts === null || watts >= MIN_ADAPTER_WATTS;
}

function notify(title, body) {
    try {
        Gio.Subprocess.new(['notify-send', '-u', 'normal', '-i', 'dialog-warning',
                            '-a', 'ThinkBook G8+ Geek Mode', title, body],
                           Gio.SubprocessFlags.NONE);
    } catch (e) {
        logError(e, 'thinkbook-g8plus-geekmode: notify-send failed');
    }
}

const GeekToggle = GObject.registerClass(
class GeekToggle extends QuickToggle {
    _init() {
        super._init({
            label: tr('Extreme Mode', '极客模式'),
            iconName: 'power-profile-performance-symbolic',
            toggleMode: true,
        });
        this.label = tr('Extreme Mode', '极客模式');
        this.connect('clicked', () => this._apply(this.checked));
    }

    refresh() {
        this.checked = isGeekOn();
        this.visible = geekSupported() && onAcPower() && adapterQualified();
    }

    _apply(on) {
        let proc;
        try {
            proc = Gio.Subprocess.new(['pkexec', GEEK_HELPER, on ? 'on' : 'off'],
                                      Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, 'thinkbook-g8plus-geekmode: failed to launch helper');
            this.refresh();
            return;
        }
        proc.wait_check_async(null, (p, res) => {
            let ok = true;
            try {
                p.wait_check_finish(res);
            } catch (e) {
                ok = false;
                logError(e, 'thinkbook-g8plus-geekmode: helper failed');
            }
            this.refresh();
            if (ok && on && isGeekOn())
                this._maybeWarnAdapter();
        });
    }

    _maybeWarnAdapter() {
        // Honour the shared "don't remind again" flag (geek notify off).
        if (GLib.file_test(WARN_FLAG, GLib.FileTest.EXISTS))
            return;

        const watts = adapterWatts();
        if (watts === null || watts < MIN_ADAPTER_WATTS || watts >= RECOMMEND_ADAPTER_WATTS)
            return;

        const title = tr('Extreme Mode', '极客模式');
        const body = tr('We recommend using a 245W+ official adapter in Extreme mode.',
                        '建议在极客模式下使用 245W 及以上原装适配器。');
        notify(title, body);
    }
});

const GeekIndicator = GObject.registerClass(
class GeekIndicator extends SystemIndicator {
    _init() {
        super._init();
        this._toggle = new GeekToggle();
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class ThinkBookG8PlusGeekMode extends Extension {
    enable() {
        this._indicator = new GeekIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._refresh();
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _refresh() {
        const toggle = this._indicator._toggle;
        toggle.refresh();
        // Hide the whole indicator (top-bar icon + tile) when not applicable.
        this._indicator.visible = toggle.visible;
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._indicator.quickSettingsItems.forEach(item => item.destroy());
        this._indicator.destroy();
        this._indicator = null;
        adapterSource = null;
    }
}
