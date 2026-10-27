using System;
using System.Runtime.InteropServices;
using System.Threading;

public class DirectPostTest {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

    const uint WM_SETTEXT = 0x000C;
    const uint WM_CHAR = 0x0102;

    public static void SendCharsToHandle(IntPtr hWnd, string text) {
        foreach (char c in text) {
            PostMessage(hWnd, WM_CHAR, (IntPtr)c, IntPtr.Zero);
            Thread.Sleep(30);
        }
    }

    public static void SetTextDirect(IntPtr hWnd, string text) {
        SendMessage(hWnd, WM_SETTEXT, IntPtr.Zero, text);
    }
}
