# -*- coding: utf-8 -*-
"""
净值分析台 · 开机自启管理（无窗口）
=================================================
用法：
    py -3 tools/autostart.py install     安装开机自启（并立即后台启动）
    py -3 tools/autostart.py uninstall   卸载开机自启
    py -3 tools/autostart.py status      查看当前状态
    py -3 tools/autostart.py start       只启动后台服务（不注册自启）
    py -3 tools/autostart.py stop        停止后台服务

实现策略（按优先级自动选择，失败自动降级）：
    1. Windows 计划任务（登录触发，pythonw 无窗口）
    2. 启动文件夹放 .lnk 快捷方式（目标 pythonw.exe）
    3. 启动文件夹放 .vbs 静默脚本
自启时不打开浏览器，日志写在 档案/服务日志.txt。
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import shutil

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(PROJECT, 'server', 'archive_server.py')
ARCHIVE_DIR = os.path.join(PROJECT, '档案')
STATUS_JSON = os.path.join(ARCHIVE_DIR, '服务状态.json')
LOG_FILE = os.path.join(ARCHIVE_DIR, '服务日志.txt')

TASK_NAME = '净值分析台档案服务'
STARTUP_DIR = os.path.join(os.environ.get('APPDATA', ''),
                           'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
LNK_PATH = os.path.join(STARTUP_DIR, TASK_NAME + '.lnk')
VBS_PATH = os.path.join(STARTUP_DIR, TASK_NAME + '.vbs')

PORTS = [8791, 8792, 8793, 8794, 8795]
NO_WINDOW = 0x08000000 if sys.platform.startswith('win') else 0


# ---------------------------------------------------------------- 基础工具
def say(msg=''):
    try:
        print(msg, flush=True)
    except Exception:
        pass


def pyw():
    """找到 pythonw.exe：不弹控制台的解释器。"""
    cand = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    if os.path.exists(cand):
        return cand
    found = shutil.which('pythonw')
    if found:
        return found
    return sys.executable


def ps_quote(s):
    return "'" + str(s).replace("'", "''") + "'"


def run_ps(script):
    """执行一段 PowerShell，返回 (ok, output)。临时脚本用 UTF-8 BOM 保存，中文路径安全。"""
    tmp = os.path.join(os.environ.get('TEMP', PROJECT), '_nav_autostart.ps1')
    with open(tmp, 'w', encoding='utf-8-sig') as f:
        f.write(script)
    try:
        p = subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            creationflags=NO_WINDOW, timeout=60
        )
        out = (p.stdout or b'').decode('utf-8', 'replace').strip()
        return p.returncode == 0, out
    except Exception as e:  # noqa: BLE001
        return False, '%s: %s' % (type(e).__name__, e)
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass


def ping(port, timeout=0.7):
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/ping' % port, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception:
        return None


def find_running():
    for p in PORTS:
        info = ping(p)
        if info and info.get('ok'):
            return p, info
    return None, None


# ---------------------------------------------------------------- 计划任务
def task_installed():
    ok, out = run_ps(
        "try { $t = Get-ScheduledTask -TaskName %s -ErrorAction Stop; 'STATE=' + $t.State } "
        "catch { 'MISSING' }" % ps_quote(TASK_NAME)
    )
    return ok and 'STATE=' in out


def install_task():
    args = '"%s" --silent' % SERVER
    script = """
$ErrorActionPreference = 'Stop'
$exe = {exe}
$arg = {arg}
$wd  = {wd}
$name = {name}
$action  = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory $wd
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$set.ExecutionTimeLimit = 'PT0S'
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $set -Description '净值分析台本地档案服务（无窗口后台）' -Force | Out-Null
'OK'
""".format(exe=ps_quote(pyw()), arg=ps_quote(args), wd=ps_quote(PROJECT), name=ps_quote(TASK_NAME))
    ok, out = run_ps(script)
    return (ok and 'OK' in out), out


def uninstall_task():
    script = (
        "try { Unregister-ScheduledTask -TaskName " + ps_quote(TASK_NAME) +
        " -Confirm:$false -ErrorAction Stop; 'REMOVED' } catch { 'NOTFOUND' }"
    )
    ok, out = run_ps(script)
    return ('REMOVED' in out), out


# ---------------------------------------------------------------- 启动文件夹
def install_shortcut():
    script = """
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut({lnk})
$s.TargetPath = {exe}
$s.Arguments = {arg}
$s.WorkingDirectory = {wd}
$s.WindowStyle = 7
$s.Description = '净值分析台本地档案服务（无窗口后台）'
$s.Save()
'OK'
""".format(lnk=ps_quote(LNK_PATH), exe=ps_quote(pyw()),
           arg=ps_quote('"%s" --silent' % SERVER), wd=ps_quote(PROJECT))
    ok, out = run_ps(script)
    return (ok and 'OK' in out and os.path.exists(LNK_PATH)), out


def install_vbs():
    body = (
        'Set sh = CreateObject("WScript.Shell")\r\n'
        'sh.CurrentDirectory = "%s"\r\n'
        'sh.Run """%s"" ""%s"" --silent", 0, False\r\n'
    ) % (PROJECT, pyw(), SERVER)
    os.makedirs(STARTUP_DIR, exist_ok=True)
    for enc in ('mbcs', 'utf-16'):
        try:
            with open(VBS_PATH, 'w', encoding=enc) as f:
                f.write(body)
            return True, 'vbs'
        except Exception:
            continue
    return False, '写 vbs 失败'


def startup_files():
    return [p for p in (LNK_PATH, VBS_PATH) if os.path.exists(p)]


def remove_startup_files():
    removed = []
    for p in startup_files():
        try:
            os.remove(p)
            removed.append(p)
        except Exception:
            pass
    return removed


# ---------------------------------------------------------------- 服务进程
def start_background():
    port, info = find_running()
    if port:
        return port, 'already'
    subprocess.Popen(
        [pyw(), SERVER, '--silent'],
        cwd=PROJECT,
        creationflags=NO_WINDOW,
        close_fds=True
    )
    for _ in range(30):
        time.sleep(0.3)
        port, info = find_running()
        if port:
            return port, 'started'
    return None, 'failed'


def stop_background():
    stopped = []
    if os.path.exists(STATUS_JSON):
        try:
            with open(STATUS_JSON, 'r', encoding='utf-8') as f:
                pid = int(json.load(f).get('pid') or 0)
        except Exception:
            pid = 0
        if pid:
            p = subprocess.run(['taskkill', '/PID', str(pid), '/F'],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               creationflags=NO_WINDOW)
            if p.returncode == 0:
                stopped.append(pid)
    # 兜底：状态文件丢了就按端口找进程
    if not stopped:
        port, info = find_running()
        if port:
            pid = 0
            try:
                pid = int((info or {}).get('pid') or 0)
            except Exception:
                pid = 0
            if pid:
                subprocess.run(['taskkill', '/PID', str(pid), '/F'],
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               creationflags=NO_WINDOW)
                stopped.append(pid)
    time.sleep(0.8)
    return stopped


def kill_stale_status():
    if os.path.exists(STATUS_JSON) and not find_running()[0]:
        try:
            os.remove(STATUS_JSON)
        except Exception:
            pass


# ---------------------------------------------------------------- 命令
def cmd_install():
    say('')
    say('  净值分析台 · 安装开机自启（无窗口后台）')
    say('  ------------------------------------------')
    say('  项目目录：%s' % PROJECT)
    say('  解释器　：%s' % pyw())

    method = ''
    ok_task, task_out = install_task()
    if ok_task:
        method = '计划任务'
        # 计划任务装好后，启动文件夹里的旧文件一并清理，避免双份
        remove_startup_files()
    else:
        say('  计划任务注册失败，改用启动文件夹方式…')
        if task_out:
            say('  （原因：%s）' % task_out.splitlines()[-1][:160])
        ok_lnk, _ = install_shortcut()
        if ok_lnk:
            method = '启动文件夹快捷方式'
            if os.path.exists(VBS_PATH):
                try:
                    os.remove(VBS_PATH)
                except Exception:
                    pass
        else:
            ok_vbs, vbs_out = install_vbs()
            if ok_vbs:
                method = '启动文件夹静默脚本'
            else:
                say('  ✗ 两种方式都失败了：%s' % vbs_out)
                return 1

    say('  ✓ 已注册：%s' % method)
    say('  触发时机：登录 Windows 后自动后台运行（不弹窗口、不打开网页）')
    say('  日志文件：%s' % LOG_FILE)

    port, how = start_background()
    if port:
        say('  ✓ 服务已就绪：http://127.0.0.1:%d/index.html' % port)
    else:
        say('  ! 服务暂时没起来，可稍后执行 “查看自启状态.bat” 看日志。')
    say('')
    return 0


def cmd_uninstall():
    say('')
    say('  卸载开机自启')
    say('  ------------------------------------------')
    removed = []
    if task_installed():
        ok, _ = uninstall_task()
        if ok:
            removed.append('计划任务「%s」' % TASK_NAME)
    for p in remove_startup_files():
        removed.append(os.path.basename(p))
    if removed:
        for r in removed:
            say('  ✓ 已移除：%s' % r)
    else:
        say('  · 没有发现自启项（本来就没装，或已手动清理过）')

    say('')
    if '--stop' in sys.argv or '-y' in sys.argv:
        ans = 'y'
    elif '--keep' in sys.argv:
        ans = 'n'
    else:
        try:
            ans = input('  是否同时停止正在运行的后台服务？[y/N] ').strip().lower()
        except Exception:
            ans = 'n'
    if ans == 'y':
        stopped = stop_background()
        kill_stale_status()
        if stopped:
            say('  ✓ 已停止（pid %s）' % ', '.join(str(x) for x in stopped))
        else:
            say('  · 没有在运行的服务')
    else:
        say('  · 服务保持运行，需要时可双击「停止档案服务.bat」')
    say('')
    return 0


def cmd_status():
    port, info = find_running()
    say('')
    say('  净值分析台 · 运行与自启状态')
    say('  ------------------------------------------')
    say('  开机自启：%s' % ('已开启' if (task_installed() or startup_files()) else '未开启'))
    if task_installed():
        say('    方式：计划任务「%s」（登录触发）' % TASK_NAME)
    for p in startup_files():
        say('    方式：启动文件夹 %s' % os.path.basename(p))
    say('  后台服务：%s' % (('运行中 · 端口 %d' % port) if port else '未运行'))
    if port:
        say('    页面地址：http://127.0.0.1:%d/index.html' % port)
        say('    档案目录：%s' % (info or {}).get('dir', ''))
    if os.path.exists(STATUS_JSON):
        try:
            with open(STATUS_JSON, 'r', encoding='utf-8') as f:
                st = json.load(f)
            say('    进程 pid：%s　启动于 %s' % (st.get('pid'), st.get('startedAt')))
        except Exception:
            pass
    say('  日志文件：%s%s' % (LOG_FILE, '' if os.path.exists(LOG_FILE) else '（还没生成）'))
    say('')
    return 0


def cmd_start():
    port, how = start_background()
    if port:
        say('  服务已就绪：http://127.0.0.1:%d/index.html（%s）'
            % (port, '本来就在运行' if how == 'already' else '刚启动'))
        return 0
    say('  启动失败，请查看日志：%s' % LOG_FILE)
    return 1


def cmd_stop():
    stopped = stop_background()
    kill_stale_status()
    if stopped:
        say('  已停止后台服务（pid %s）' % ', '.join(str(x) for x in stopped))
        return 0
    if find_running()[0]:
        say('  没找到进程号，服务似乎仍在运行；可在任务管理器结束 pythonw.exe')
        return 1
    say('  没有在运行的后台服务')
    return 0


COMMANDS = {
    'install': cmd_install,
    'uninstall': cmd_uninstall,
    'status': cmd_status,
    'start': cmd_start,
    'stop': cmd_stop,
}


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    cmd = (sys.argv[1] if len(sys.argv) > 1 else 'status').lower()
    fn = COMMANDS.get(cmd)
    if not fn:
        say('用法：py -3 tools/autostart.py [install|uninstall|status|start|stop]')
        return 2
    return fn()


if __name__ == '__main__':
    sys.exit(main())
