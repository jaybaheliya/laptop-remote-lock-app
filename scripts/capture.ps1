param([string]$OutputPath)

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Win32Capture {
    [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hDC, int nWidth, int nHeight);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr hObject, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hObjectSource, int nXSrc, int nYSrc, int dwRop);

    public static void SaveScreen(string path) {
        int w = GetSystemMetrics(0); // SM_CXSCREEN
        int h = GetSystemMetrics(1); // SM_CYSCREEN
        IntPtr hWnd = GetDesktopWindow();
        IntPtr hDeskDC = GetWindowDC(hWnd);
        IntPtr hMemDC = CreateCompatibleDC(hDeskDC);
        IntPtr hBmp = CreateCompatibleBitmap(hDeskDC, w, h);
        IntPtr hOld = SelectObject(hMemDC, hBmp);
        BitBlt(hMemDC, 0, 0, w, h, hDeskDC, 0, 0, 0x00CC0020); // SRCCOPY
        using (Bitmap bmp = Image.FromHbitmap(hBmp)) {
            bmp.Save(path, ImageFormat.Jpeg);
        }
        SelectObject(hMemDC, hOld);
        DeleteObject(hBmp);
        DeleteDC(hMemDC);
        ReleaseDC(hWnd, hDeskDC);
    }
}
"@ -ReferencedAssemblies System.Drawing

[Win32Capture]::SaveScreen($OutputPath)

