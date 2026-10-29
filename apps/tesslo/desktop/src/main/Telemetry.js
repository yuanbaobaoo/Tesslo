import {ipcMain} from 'electron';

// Tesslo does not send telemetry. The IPC handlers stay in place so the GUI
// sees an explicit opt-out instead of falling back to its consent dialog.
const telemetry = {
    didOptIn: false,
    appWasOpened () {},
    appWillClose () {},
    projectDidLoad () {},
    projectDidSave () {},
    projectSaveCompleted () {},
    projectSaveCanceled () {},
    projectWasCreated () {},
    projectWasUploaded () {}
};

ipcMain.handle('getTelemetryDidOptIn', () => false);
ipcMain.on('getTelemetryDidOptIn', event => {
    event.returnValue = false;
});
ipcMain.on('setTelemetryDidOptIn', () => {});
ipcMain.on('projectDidLoad', () => {});
ipcMain.on('projectDidSave', () => {});
ipcMain.on('projectWasCreated', () => {});
ipcMain.on('projectWasUploaded', () => {});

export default telemetry;
