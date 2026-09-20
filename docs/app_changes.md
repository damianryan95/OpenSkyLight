The core focus of these improvements is phone first, but locally hosted... the user owns the data...... no cloud service or off device storage happens.
All skylight setup happens on phone first. The raspberry should output a wifi signal for the phone to connect too, the phone app configures the screen, the phone app user journey on first start should be a wizard... walking the user through the journey of configuring the screen and the application.
 
Raspberry PI docker container deployment, a single rapserbery creates a network accessible service. Must be 100% headless... including the setting of the DNS name functionality
 
Add DNS name functionality... https://openskylight or similar
 
Create a phone app that manages the board, allows calendar sync to happen at a phone level using native connectors, then pushes that to a raspberry server. No user should have to.configure an api or cloud connector!!
 
Calendar sync is multi directional, when adding through skylight
 
Allow native remote access direct to device home without a cloud service, or investigate something like cloudfare unattended to make this happen. Again must be automatic/at home sync via phone enabled.
 
Backup service for restore functionality, backup to local usb device and a person's cloud based storage service. Do not require a central backup solution. Only for core services, settings and calendar details.. photos etc will not be backed up.
 
Review the original project and analyse what functionality has been removed. Create it as a bullet list, we will select what goes back on.
 
Later  phases when project considered sellable
 
Sd card functionality, raspberry storage for photo.s photos are never backed up
 
The PI must be secure, nobody should be able to access this thing unless they are the developer, me
 
Power off, reboot etc must be mainly software... but allow for hardwired button/usb switch to also conduct a reboot/sleep/power off