$code = @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinFocusHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);

    public static string GetInfo() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sbTitle = new StringBuilder(256);
        StringBuilder sbClass = new StringBuilder(256);
        GetWindowText(h, sbTitle, 256);
        GetClassName(h, sbClass, 256);
        return "Handle: " + h + " | Title: [" + sbTitle.ToString() + "] | Class: [" + sbClass.ToString() + "]";
    }
}
"@

Add-Type -TypeDefinition $code
[WinFocusHelper]::GetInfo()
