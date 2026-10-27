using System;
using System.Runtime.InteropServices;
using System.Threading;

public class WinTypeTest {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern short VkKeyScan(char ch);

    const uint KEYEVENTF_KEYDOWN = 0x0000;
    const uint KEYEVENTF_KEYUP = 0x0002;

    public static void SendChar(char c) {
        short vkScan = VkKeyScan(c);
        byte vk = (byte)(vkScan & 0xFF);
        byte shift = (byte)((vkScan >> 8) & 0xFF);

        if ((shift & 1) != 0) {
            keybd_event(0x10, 0x2A, KEYEVENTF_KEYDOWN, UIntPtr.Zero);
            Thread.Sleep(20);
        }

        byte scan = (byte)MapVirtualKey(vk, 0);
        keybd_event(vk, scan, KEYEVENTF_KEYDOWN, UIntPtr.Zero);
        Thread.Sleep(35);
        keybd_event(vk, scan, KEYEVENTF_KEYUP, UIntPtr.Zero);
        Thread.Sleep(35);

        if ((shift & 1) != 0) {
            keybd_event(0x10, 0x2A, KEYEVENTF_KEYUP, UIntPtr.Zero);
            Thread.Sleep(20);
        }
    }
}
