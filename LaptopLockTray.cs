using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace LaptopLockTrayApp {
    static class Program {
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool LockWorkStation();

        // Crucial: keep root-level static references so GC never collects or destroys the tray icon!
        private static Mutex singleInstanceMutex;
        private static NotifyIcon trayIcon;
        private static ContextMenuStrip menu;
        private static ApplicationContext appContext;
        private static System.Windows.Forms.Timer keepAliveTimer;

        [STAThread]
        static void Main() {
            string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LaptopLockAgent", "logs");
            if (!Directory.Exists(logDir)) {
                Directory.CreateDirectory(logDir);
            }
            string logPath = Path.Combine(logDir, "tray_native.log");

            try {
                File.AppendAllText(logPath, "[TRAY " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Starting LaptopLockTray...\n");
                bool isNew;
                singleInstanceMutex = new Mutex(true, "LaptopLockTraySingleInstanceMutex", out isNew);
                if (!isNew) {
                    File.AppendAllText(logPath, "[TRAY " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Another instance already running. Exiting.\n");
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                trayIcon = new NotifyIcon();

                string appDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = Path.Combine(appDir, "app_icon.ico");
                if (File.Exists(icoPath)) {
                    try {
                        trayIcon.Icon = new Icon(icoPath);
                        File.AppendAllText(logPath, "[TRAY] Loaded custom icon from " + icoPath + "\n");
                    } catch (Exception ex) {
                        File.AppendAllText(logPath, "[TRAY] Failed to load custom icon: " + ex.Message + ", using SystemIcons.Shield\n");
                        trayIcon.Icon = SystemIcons.Shield;
                    }
                } else {
                    File.AppendAllText(logPath, "[TRAY] Icon not found at " + icoPath + ", using SystemIcons.Shield\n");
                    trayIcon.Icon = SystemIcons.Shield;
                }

                trayIcon.Text = "Laptop Remote Lock - Active";
                trayIcon.Visible = true;

                menu = new ContextMenuStrip();

                ToolStripMenuItem titleItem = new ToolStripMenuItem("Laptop Remote Lock");
                titleItem.Enabled = false;
                titleItem.Font = new Font(titleItem.Font, FontStyle.Bold);
                menu.Items.Add(titleItem);

                ToolStripMenuItem statusItem = new ToolStripMenuItem("Status: Active (Connected)");
                statusItem.Enabled = false;
                menu.Items.Add(statusItem);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem lockItem = new ToolStripMenuItem("Lock Workstation Now");
                lockItem.Click += delegate(object s, EventArgs e) {
                    try { LockWorkStation(); } catch { }
                };
                menu.Items.Add(lockItem);

                ToolStripMenuItem webItem = new ToolStripMenuItem("Open Web Controller");
                webItem.Click += delegate(object s, EventArgs e) {
                    try {
                        Process.Start(new ProcessStartInfo("https://laptop-remote-lock-app-mobile-contr-nine.vercel.app") { UseShellExecute = true });
                    } catch { }
                };
                menu.Items.Add(webItem);

                ToolStripMenuItem logItem = new ToolStripMenuItem("View Agent Logs");
                logItem.Click += delegate(object s, EventArgs e) {
                    string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                    string logFile = Path.Combine(localApp, "LaptopLockAgent", "logs", "agent.log");
                    if (File.Exists(logFile)) {
                        try { Process.Start("notepad.exe", logFile); } catch { }
                    } else {
                        MessageBox.Show("Log file not found yet.", "Laptop Remote Lock", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                };
                menu.Items.Add(logItem);

                menu.Items.Add(new ToolStripSeparator());

                ToolStripMenuItem exitItem = new ToolStripMenuItem("Exit Agent");
                exitItem.Click += delegate(object s, EventArgs e) {
                    File.AppendAllText(logPath, "[TRAY " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] User clicked Exit Agent.\n");
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                    try {
                        foreach (Process p in Process.GetProcessesByName("node")) {
                            try { p.Kill(); } catch { }
                        }
                    } catch { }
                    if (appContext != null) {
                        appContext.ExitThread();
                    }
                    Application.Exit();
                };
                menu.Items.Add(exitItem);

                trayIcon.ContextMenuStrip = menu;

                // Show a brief balloon tip on start so the user immediately sees where it is
                try {
                    trayIcon.ShowBalloonTip(3000, "Laptop Remote Lock", "Agent is running and active in the system tray.", ToolTipIcon.Info);
                } catch { }

                // Timer every 30 seconds to ensure message pump is healthy and log heartbeat
                keepAliveTimer = new System.Windows.Forms.Timer();
                keepAliveTimer.Interval = 30000;
                keepAliveTimer.Tick += delegate(object s, EventArgs e) {
                    if (trayIcon != null && !trayIcon.Visible) {
                        trayIcon.Visible = true;
                    }
                };
                keepAliveTimer.Start();

                appContext = new ApplicationContext();
                File.AppendAllText(logPath, "[TRAY " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Entering Application.Run()...\n");
                Application.Run(appContext);
                File.AppendAllText(logPath, "[TRAY " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] Application.Run exited normally.\n");
            } catch (Exception ex) {
                File.AppendAllText(logPath, "[TRAY ERROR " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + ex.ToString() + "\n");
            } finally {
                GC.KeepAlive(singleInstanceMutex);
                GC.KeepAlive(trayIcon);
                GC.KeepAlive(menu);
                GC.KeepAlive(appContext);
            }
        }
    }
}
