Dim shell, fso, scriptDir

Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")

' Bu dosyanın bulunduğu klasörü al
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Sunucuyu arka planda başlat (pencere yok)
shell.Run "cmd /c cd /d """ & scriptDir & """ && node gui/server.js", 0, False

' Tarayıcı açılmadan önce sunucunun ayağa kalkması için 2 saniye bekle
WScript.Sleep 2000

' Tarayıcıyı aç
shell.Run "http://localhost:7845", 1, False
