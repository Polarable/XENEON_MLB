// ==WindhawkMod==
// @id              shutout-taskbar
// @name            SHUTOUT taskbar scorebug
// @description     Live MLB scorebug with big-play callouts and baseball news at the left end of the taskbar, where the weather sits
// @version         1.0.0
// @author          polarable
// @github          https://github.com/Polarable
// @homepage        https://polarable.github.io/XENEON_MLB/m/
// @include         explorer.exe
// @architecture    x86-64
// @compilerOptions -lole32 -loleaut32 -lshlwapi -lshell32 -ldwmapi -luuid
// ==/WindhawkMod==

// ==WindhawkModReadme==
/*
# SHUTOUT taskbar scorebug

A small SHUTOUT widget at the left end of the Windows 11 taskbar, in the spot the weather widget uses.

- **Game**: a full scorebug for your team's game. Score, inning, bases, count, outs, the last pitch with its speed, and the batter against the pitcher.
- **Big plays**: home runs, big hits, runs, double plays and the like sweep across the bar in the batting team's color and say what happened.
- **News**: the latest MLB Trade Rumors story, the latest about your team, or a carousel.
- **Auto** (the default) shows the game while your team is playing and the news carousel the rest of the time.

Scroll over the bar to switch what it shows. Click it to open a taller view above the taskbar with the linescore, the at-bat pitch by pitch, recent plays and today's other games, or the full story. Player names and the **Open in SHUTOUT** button open the page in the SHUTOUT app, or in your browser if the app isn't installed. Click the bar again, or anywhere else, to close it.

## Setup
1. Turn off the Windows weather widget so this one can take its place: **Settings > Personalization > Taskbar > Widgets: Off**.
2. Install this mod. It needs the Microsoft Edge WebView2 Runtime, which Windows 11 already has.
3. If the widget doesn't show up, open the mod's **Log** tab in Windhawk. When it says the WebView2 loader is missing, run this once in PowerShell, then turn the mod off and on again:
   ```
   $d="$env:ProgramData\SHUTOUT"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2 -OutFile "$d\wv2.zip"; Expand-Archive "$d\wv2.zip" "$d\wv2" -Force; Copy-Item "$d\wv2\build\native\x64\WebView2Loader.dll" $d
   ```

## Opening pages in the installed app
Pages open in your default browser unless you set **App command**. To send them to the installed SHUTOUT app instead (Chrome or Edge), right-click the SHUTOUT shortcut in the Start menu, choose **Open file location**, open the shortcut's **Properties**, copy **Target**, and paste it into **App command** with this added to the end:

`--app-launch-url-for-shortcuts-menu-item={url}`

## Settings
Width, the gap from the left edge, the height of the open view and your team can all be changed in the Settings tab. The team picked in the widget's own settings (the sliders icon in the open view) wins over the one here.
*/
// ==/WindhawkModReadme==

// ==WindhawkModSettings==
/*
- team: HOU
  $name: Team
  $description: Team abbreviation (HOU, NYY, LAD...) the widget follows at first. You can change it in the widget too.
- width: 560
  $name: Width
  $description: Width of the bar in pixels at 100% scale
- offset: 12
  $name: Gap from the left edge
  $description: Pixels between the left end of the taskbar and the bar. Raise it if your taskbar icons are left aligned.
- panelHeight: 540
  $name: Height of the open view
  $description: Pixels at 100% scale
- background: acrylic
  $name: Background
  $description: Acrylic lets the taskbar show through. Use solid if the bar looks black or blank.
  $options:
  - acrylic: Acrylic
  - solid: Solid
- hideFullscreen: true
  $name: Hide during fullscreen apps and games
- appCommand: ""
  $name: App command
  $description: Command that opens a page in the installed SHUTOUT app, with {url} where the page address goes. Leave empty to use the browser. See the Details tab.
- url: https://polarable.github.io/XENEON_MLB/bar/
  $name: Widget address
- loaderPath: "%ProgramData%\\SHUTOUT\\WebView2Loader.dll"
  $name: WebView2 loader
  $description: Only needed if the Log says the WebView2 runtime couldn't be started directly
*/
// ==/WindhawkModSettings==

#include <windows.h>
#include <windowsx.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <dwmapi.h>
#include <objbase.h>
#include <string>
#include <functional>
#include <atomic>

// ---------------------------------------------------------------------------------------------
// The slice of WebView2.h (SDK 1.0.2903.40) this mod uses, copied exactly so the vtables match.
// Windhawk compiles a single file, so the SDK header can't be included.
// ---------------------------------------------------------------------------------------------
#ifndef MIDL_INTERFACE
#define MIDL_INTERFACE(x) struct __declspec(novtable)
#endif
#ifndef __eventtoken_h__
typedef struct EventRegistrationToken { __int64 value; } EventRegistrationToken;
#endif
typedef int COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT;
typedef int COREWEBVIEW2_MOVE_FOCUS_REASON;
typedef int COREWEBVIEW2_PROCESS_FAILED_KIND;
typedef int COREWEBVIEW2_WEB_RESOURCE_CONTEXT;
typedef struct COREWEBVIEW2_COLOR
    {
    BYTE A;
    BYTE R;
    BYTE G;
    BYTE B;
    } 	COREWEBVIEW2_COLOR;
struct ICoreWebView2AcceleratorKeyPressedEventHandler;
struct ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler;
struct ICoreWebView2CallDevToolsProtocolMethodCompletedHandler;
struct ICoreWebView2CapturePreviewCompletedHandler;
struct ICoreWebView2ContainsFullScreenElementChangedEventHandler;
struct ICoreWebView2ContentLoadingEventHandler;
struct ICoreWebView2Deferral;
struct ICoreWebView2DevToolsProtocolEventReceiver;
struct ICoreWebView2DocumentTitleChangedEventHandler;
struct ICoreWebView2ExecuteScriptCompletedHandler;
struct ICoreWebView2FocusChangedEventHandler;
struct ICoreWebView2HistoryChangedEventHandler;
struct ICoreWebView2MoveFocusRequestedEventHandler;
struct ICoreWebView2NavigationCompletedEventHandler;
struct ICoreWebView2NavigationStartingEventHandler;
struct ICoreWebView2NewBrowserVersionAvailableEventHandler;
struct ICoreWebView2PermissionRequestedEventHandler;
struct ICoreWebView2ScriptDialogOpeningEventHandler;
struct ICoreWebView2SourceChangedEventHandler;
struct ICoreWebView2WebResourceRequestedEventHandler;
struct ICoreWebView2WebResourceResponse;
struct ICoreWebView2WindowCloseRequestedEventHandler;
struct ICoreWebView2WindowFeatures;
struct ICoreWebView2ZoomFactorChangedEventHandler;
struct ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler;
struct ICoreWebView2Environment;
struct ICoreWebView2CreateCoreWebView2ControllerCompletedHandler;
struct ICoreWebView2Controller;
struct ICoreWebView2Controller2;
struct ICoreWebView2;
struct ICoreWebView2Settings;
struct ICoreWebView2WebMessageReceivedEventHandler;
struct ICoreWebView2WebMessageReceivedEventArgs;
struct ICoreWebView2NewWindowRequestedEventHandler;
struct ICoreWebView2NewWindowRequestedEventArgs;
struct ICoreWebView2ProcessFailedEventHandler;
struct ICoreWebView2ProcessFailedEventArgs;
    MIDL_INTERFACE("4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d")
    ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE Invoke( 
             HRESULT errorCode,
             ICoreWebView2Environment *result) = 0;
    };
    MIDL_INTERFACE("b96d755e-0319-4e92-a296-23436f46a1fc")
    ICoreWebView2Environment : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE CreateCoreWebView2Controller( 
            HWND parentWindow,
            ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *handler) = 0;
        virtual HRESULT STDMETHODCALLTYPE CreateWebResourceResponse( 
             IStream *content,
             int statusCode,
             LPCWSTR reasonPhrase,
             LPCWSTR headers,
             ICoreWebView2WebResourceResponse **response) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_BrowserVersionString( 
             LPWSTR *versionInfo) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_NewBrowserVersionAvailable( 
             ICoreWebView2NewBrowserVersionAvailableEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_NewBrowserVersionAvailable( 
             EventRegistrationToken token) = 0;
    };
    MIDL_INTERFACE("6c4819f3-c9b7-4260-8127-c9f5bde7f68c")
    ICoreWebView2CreateCoreWebView2ControllerCompletedHandler : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE Invoke( 
             HRESULT errorCode,
             ICoreWebView2Controller *result) = 0;
    };
    MIDL_INTERFACE("4d00c0d1-9434-4eb6-8078-8697a560334f")
    ICoreWebView2Controller : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_IsVisible( 
             BOOL *isVisible) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsVisible( 
             BOOL isVisible) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_Bounds( 
             RECT *bounds) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_Bounds( 
             RECT bounds) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_ZoomFactor( 
             double *zoomFactor) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_ZoomFactor( 
             double zoomFactor) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_ZoomFactorChanged( 
             ICoreWebView2ZoomFactorChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_ZoomFactorChanged( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE SetBoundsAndZoomFactor( 
             RECT bounds,
             double zoomFactor) = 0;
        virtual HRESULT STDMETHODCALLTYPE MoveFocus( 
             COREWEBVIEW2_MOVE_FOCUS_REASON reason) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_MoveFocusRequested( 
             ICoreWebView2MoveFocusRequestedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_MoveFocusRequested( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_GotFocus( 
             ICoreWebView2FocusChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_GotFocus( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_LostFocus( 
             ICoreWebView2FocusChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_LostFocus( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_AcceleratorKeyPressed( 
             ICoreWebView2AcceleratorKeyPressedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_AcceleratorKeyPressed( 
             EventRegistrationToken token) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_ParentWindow( 
             HWND *parentWindow) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_ParentWindow( 
             HWND parentWindow) = 0;
        virtual HRESULT STDMETHODCALLTYPE NotifyParentWindowPositionChanged( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE Close( void) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_CoreWebView2( 
             ICoreWebView2 **coreWebView2) = 0;
    };
    MIDL_INTERFACE("c979903e-d4ca-4228-92eb-47ee3fa96eab")
    ICoreWebView2Controller2 : public ICoreWebView2Controller
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_DefaultBackgroundColor( 
             COREWEBVIEW2_COLOR *value) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_DefaultBackgroundColor( 
             COREWEBVIEW2_COLOR value) = 0;
    };
    MIDL_INTERFACE("76eceacb-0462-4d94-ac83-423a6793775e")
    ICoreWebView2 : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_Settings( 
             ICoreWebView2Settings **settings) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_Source( 
             LPWSTR *uri) = 0;
        virtual HRESULT STDMETHODCALLTYPE Navigate( 
             LPCWSTR uri) = 0;
        virtual HRESULT STDMETHODCALLTYPE NavigateToString( 
             LPCWSTR htmlContent) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_NavigationStarting( 
             ICoreWebView2NavigationStartingEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_NavigationStarting( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_ContentLoading( 
             ICoreWebView2ContentLoadingEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_ContentLoading( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_SourceChanged( 
             ICoreWebView2SourceChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_SourceChanged( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_HistoryChanged( 
             ICoreWebView2HistoryChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_HistoryChanged( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_NavigationCompleted( 
             ICoreWebView2NavigationCompletedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_NavigationCompleted( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_FrameNavigationStarting( 
             ICoreWebView2NavigationStartingEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_FrameNavigationStarting( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_FrameNavigationCompleted( 
             ICoreWebView2NavigationCompletedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_FrameNavigationCompleted( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_ScriptDialogOpening( 
             ICoreWebView2ScriptDialogOpeningEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_ScriptDialogOpening( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_PermissionRequested( 
             ICoreWebView2PermissionRequestedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_PermissionRequested( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_ProcessFailed( 
             ICoreWebView2ProcessFailedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_ProcessFailed( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE AddScriptToExecuteOnDocumentCreated( 
             LPCWSTR javaScript,
             ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler *handler) = 0;
        virtual HRESULT STDMETHODCALLTYPE RemoveScriptToExecuteOnDocumentCreated( 
             LPCWSTR id) = 0;
        virtual HRESULT STDMETHODCALLTYPE ExecuteScript( 
             LPCWSTR javaScript,
             ICoreWebView2ExecuteScriptCompletedHandler *handler) = 0;
        virtual HRESULT STDMETHODCALLTYPE CapturePreview( 
             COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT imageFormat,
             IStream *imageStream,
             ICoreWebView2CapturePreviewCompletedHandler *handler) = 0;
        virtual HRESULT STDMETHODCALLTYPE Reload( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE PostWebMessageAsJson( 
             LPCWSTR webMessageAsJson) = 0;
        virtual HRESULT STDMETHODCALLTYPE PostWebMessageAsString( 
             LPCWSTR webMessageAsString) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_WebMessageReceived( 
             ICoreWebView2WebMessageReceivedEventHandler *handler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_WebMessageReceived( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE CallDevToolsProtocolMethod( 
             LPCWSTR methodName,
             LPCWSTR parametersAsJson,
             ICoreWebView2CallDevToolsProtocolMethodCompletedHandler *handler) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_BrowserProcessId( 
             UINT32 *value) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_CanGoBack( 
             BOOL *canGoBack) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_CanGoForward( 
             BOOL *canGoForward) = 0;
        virtual HRESULT STDMETHODCALLTYPE GoBack( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE GoForward( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE GetDevToolsProtocolEventReceiver( 
             LPCWSTR eventName,
             ICoreWebView2DevToolsProtocolEventReceiver **receiver) = 0;
        virtual HRESULT STDMETHODCALLTYPE Stop( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_NewWindowRequested( 
             ICoreWebView2NewWindowRequestedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_NewWindowRequested( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_DocumentTitleChanged( 
             ICoreWebView2DocumentTitleChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_DocumentTitleChanged( 
             EventRegistrationToken token) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_DocumentTitle( 
             LPWSTR *title) = 0;
        virtual HRESULT STDMETHODCALLTYPE AddHostObjectToScript( 
             LPCWSTR name,
             VARIANT *object) = 0;
        virtual HRESULT STDMETHODCALLTYPE RemoveHostObjectFromScript( 
             LPCWSTR name) = 0;
        virtual HRESULT STDMETHODCALLTYPE OpenDevToolsWindow( void) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_ContainsFullScreenElementChanged( 
             ICoreWebView2ContainsFullScreenElementChangedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_ContainsFullScreenElementChanged( 
             EventRegistrationToken token) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_ContainsFullScreenElement( 
             BOOL *containsFullScreenElement) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_WebResourceRequested( 
             ICoreWebView2WebResourceRequestedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_WebResourceRequested( 
             EventRegistrationToken token) = 0;
        virtual HRESULT STDMETHODCALLTYPE AddWebResourceRequestedFilter( 
             const LPCWSTR uri,
             const COREWEBVIEW2_WEB_RESOURCE_CONTEXT resourceContext) = 0;
        virtual HRESULT STDMETHODCALLTYPE RemoveWebResourceRequestedFilter( 
             const LPCWSTR uri,
             const COREWEBVIEW2_WEB_RESOURCE_CONTEXT resourceContext) = 0;
        virtual HRESULT STDMETHODCALLTYPE add_WindowCloseRequested( 
             ICoreWebView2WindowCloseRequestedEventHandler *eventHandler,
             EventRegistrationToken *token) = 0;
        virtual HRESULT STDMETHODCALLTYPE remove_WindowCloseRequested( 
             EventRegistrationToken token) = 0;
    };
    MIDL_INTERFACE("e562e4f0-d7fa-43ac-8d71-c05150499f00")
    ICoreWebView2Settings : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_IsScriptEnabled( 
             BOOL *isScriptEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsScriptEnabled( 
             BOOL isScriptEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_IsWebMessageEnabled( 
             BOOL *isWebMessageEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsWebMessageEnabled( 
             BOOL isWebMessageEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_AreDefaultScriptDialogsEnabled( 
             BOOL *areDefaultScriptDialogsEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_AreDefaultScriptDialogsEnabled( 
             BOOL areDefaultScriptDialogsEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_IsStatusBarEnabled( 
             BOOL *isStatusBarEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsStatusBarEnabled( 
             BOOL isStatusBarEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_AreDevToolsEnabled( 
             BOOL *areDevToolsEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_AreDevToolsEnabled( 
             BOOL areDevToolsEnabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_AreDefaultContextMenusEnabled( 
             BOOL *enabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_AreDefaultContextMenusEnabled( 
             BOOL enabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_AreHostObjectsAllowed( 
             BOOL *allowed) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_AreHostObjectsAllowed( 
             BOOL allowed) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_IsZoomControlEnabled( 
             BOOL *enabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsZoomControlEnabled( 
             BOOL enabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_IsBuiltInErrorPageEnabled( 
             BOOL *enabled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_IsBuiltInErrorPageEnabled( 
             BOOL enabled) = 0;
    };
    MIDL_INTERFACE("57213f19-00e6-49fa-8e07-898ea01ecbd2")
    ICoreWebView2WebMessageReceivedEventHandler : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE Invoke( 
             ICoreWebView2 *sender,
             ICoreWebView2WebMessageReceivedEventArgs *args) = 0;
    };
    MIDL_INTERFACE("0f99a40c-e962-4207-9e92-e3d542eff849")
    ICoreWebView2WebMessageReceivedEventArgs : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_Source( 
             LPWSTR *value) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_WebMessageAsJson( 
             LPWSTR *value) = 0;
        virtual HRESULT STDMETHODCALLTYPE TryGetWebMessageAsString( 
             LPWSTR *value) = 0;
    };
    MIDL_INTERFACE("d4c185fe-c81c-4989-97af-2d3fa7ab5651")
    ICoreWebView2NewWindowRequestedEventHandler : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE Invoke( 
             ICoreWebView2 *sender,
             ICoreWebView2NewWindowRequestedEventArgs *args) = 0;
    };
    MIDL_INTERFACE("34acb11c-fc37-4418-9132-f9c21d1eafb9")
    ICoreWebView2NewWindowRequestedEventArgs : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_Uri( 
             LPWSTR *uri) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_NewWindow( 
             ICoreWebView2 *newWindow) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_NewWindow( 
             ICoreWebView2 **newWindow) = 0;
        virtual  HRESULT STDMETHODCALLTYPE put_Handled( 
             BOOL handled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_Handled( 
             BOOL *handled) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_IsUserInitiated( 
             BOOL *isUserInitiated) = 0;
        virtual HRESULT STDMETHODCALLTYPE GetDeferral( 
             ICoreWebView2Deferral **deferral) = 0;
        virtual  HRESULT STDMETHODCALLTYPE get_WindowFeatures( 
             ICoreWebView2WindowFeatures **value) = 0;
    };
    MIDL_INTERFACE("79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1")
    ICoreWebView2ProcessFailedEventHandler : public IUnknown
    {
    public:
        virtual HRESULT STDMETHODCALLTYPE Invoke( 
             ICoreWebView2 *sender,
             ICoreWebView2ProcessFailedEventArgs *args) = 0;
    };
    MIDL_INTERFACE("8155a9a4-1474-4a86-8cae-151b0fa6b8ca")
    ICoreWebView2ProcessFailedEventArgs : public IUnknown
    {
    public:
        virtual  HRESULT STDMETHODCALLTYPE get_ProcessFailedKind( 
             COREWEBVIEW2_PROCESS_FAILED_KIND *value) = 0;
    };
// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------
struct Settings {
    std::wstring team, url, appCommand, loaderPath, background;
    int width = 560, offset = 12, panelHeight = 540;
    bool hideFullscreen = true;
} g_set;

static std::wstring StrSetting(PCWSTR name) {
    PCWSTR v = Wh_GetStringSetting(name);
    std::wstring s = v ? v : L"";
    Wh_FreeStringSetting(v);
    return s;
}
static void LoadSettings() {
    g_set.team = StrSetting(L"team");
    g_set.url = StrSetting(L"url");
    g_set.appCommand = StrSetting(L"appCommand");
    g_set.background = StrSetting(L"background");
    WCHAR buf[MAX_PATH * 2];
    ExpandEnvironmentStringsW(StrSetting(L"loaderPath").c_str(), buf, ARRAYSIZE(buf));
    g_set.loaderPath = buf;
    g_set.width = max(200, min(1600, Wh_GetIntSetting(L"width")));
    g_set.offset = max(0, min(2000, Wh_GetIntSetting(L"offset")));
    g_set.panelHeight = max(300, min(900, Wh_GetIntSetting(L"panelHeight")));
    g_set.hideFullscreen = Wh_GetIntSetting(L"hideFullscreen") != 0;
    if (g_set.url.empty()) g_set.url = L"https://polarable.github.io/XENEON_MLB/bar/";
    if (g_set.team.empty()) g_set.team = L"HOU";
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
constexpr UINT WM_APP_RELOAD = WM_APP + 1;
constexpr UINT_PTR TIMER_POS = 1, TIMER_CLICK = 2;
static HANDLE g_thread = nullptr;
static DWORD g_threadId = 0;
static HWND g_hwnd = nullptr;
static ICoreWebView2Controller* g_controller = nullptr;
static ICoreWebView2* g_webview = nullptr;
static bool g_expanded = false;
static int g_cssBar = 48;       // bar height in CSS px, as told to the page
static int g_cssWant = 48;      // window height the page asked for, CSS px
static RECT g_lastTaskbar = {};
static UINT g_lastDpi = 0;
static bool g_hiddenForFullscreen = false;
static std::wstring g_loadedUrl;

static IID MakeIid(PCWSTR s) { IID iid{}; IIDFromString(s, &iid); return iid; }
static const IID IID_Controller2 = MakeIid(L"{c979903e-d4ca-4228-92eb-47ee3fa96eab}");
static const IID IID_EnvDone = MakeIid(L"{4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d}");
static const IID IID_CtrlDone = MakeIid(L"{6c4819f3-c9b7-4260-8127-c9f5bde7f68c}");
static const IID IID_MsgHandler = MakeIid(L"{57213f19-00e6-49fa-8e07-898ea01ecbd2}");
static const IID IID_NewWinHandler = MakeIid(L"{d4c185fe-c81c-4989-97af-2d3fa7ab5651}");
static const IID IID_FailHandler = MakeIid(L"{79e0aea4-990b-42d9-aa1d-0fcc2e5bc7f1}");

// One small COM class for every callback WebView2 wants.
template <class I, class A, class B>
class Callback : public I {
    std::atomic<ULONG> ref{1};
    IID iid;
    std::function<HRESULT(A, B)> fn;
public:
    Callback(const IID& id, std::function<HRESULT(A, B)> f) : iid(id), fn(std::move(f)) {}
    ULONG STDMETHODCALLTYPE AddRef() override { return ++ref; }
    ULONG STDMETHODCALLTYPE Release() override { ULONG r = --ref; if (!r) delete this; return r; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID r, void** p) override {
        if (IsEqualIID(r, IID_IUnknown) || IsEqualIID(r, iid)) { *p = static_cast<I*>(this); AddRef(); return S_OK; }
        *p = nullptr; return E_NOINTERFACE;
    }
    HRESULT STDMETHODCALLTYPE Invoke(A a, B b) override { return fn(a, b); }
};

// ---------------------------------------------------------------------------------------------
// Where the bar goes
// ---------------------------------------------------------------------------------------------
static HWND Taskbar() { return FindWindowW(L"Shell_TrayWnd", nullptr); }
static UINT DpiOf(HWND h) { UINT d = h ? GetDpiForWindow(h) : 96; return d ? d : 96; }

static bool TaskbarHidden(HWND tb, const RECT& r) {
    if (!tb || !IsWindowVisible(tb)) return true;
    HMONITOR mon = MonitorFromWindow(tb, MONITOR_DEFAULTTONEAREST);
    MONITORINFO mi{sizeof(mi)};
    if (!GetMonitorInfoW(mon, &mi)) return false;
    // Auto-hide parks the taskbar almost entirely off the screen.
    RECT vis; IntersectRect(&vis, &r, &mi.rcMonitor);
    return (vis.bottom - vis.top) < (r.bottom - r.top) / 2;
}
static bool FullscreenAppRunning() {
    QUERY_USER_NOTIFICATION_STATE st;
    if (SUCCEEDED(SHQueryUserNotificationState(&st)))
        return st == QUNS_BUSY || st == QUNS_RUNNING_D3D_FULL_SCREEN || st == QUNS_PRESENTATION_MODE;
    return false;
}

static void ResizeWebView() {
    if (!g_controller || !g_hwnd) return;
    RECT rc; GetClientRect(g_hwnd, &rc);
    g_controller->put_Bounds(rc);
}

static void Place() {
    HWND tb = Taskbar();
    if (!g_hwnd || !tb) return;
    RECT r; GetWindowRect(tb, &r);
    UINT dpi = DpiOf(tb);
    double scale = dpi / 96.0;
    int barH = r.bottom - r.top;
    bool hide = TaskbarHidden(tb, r) || (g_set.hideFullscreen && FullscreenAppRunning());
    if (hide) {
        if (IsWindowVisible(g_hwnd)) ShowWindow(g_hwnd, SW_HIDE);
        g_hiddenForFullscreen = true;
        return;
    }
    int cssBar = max(32, (int)(barH / scale + 0.5));
    if (cssBar != g_cssBar || dpi != g_lastDpi) {
        g_cssBar = cssBar; g_lastDpi = dpi;
        PostMessageW(g_hwnd, WM_APP_RELOAD, 0, 0);
    }
    int w = (int)(g_set.width * scale + 0.5);
    int h = g_expanded ? (int)(g_cssWant * scale + 0.5) : barH;
    int x = r.left + (int)(g_set.offset * scale + 0.5);
    int y = r.bottom - h;
    SetWindowPos(g_hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    g_lastTaskbar = r;
    g_hiddenForFullscreen = false;
    ResizeWebView();
}

static std::wstring PageUrl() {
    std::wstring u = g_set.url;
    u += (u.find(L'?') == std::wstring::npos) ? L"?" : L"&";
    u += L"h=" + std::to_wstring(g_cssBar) + L"&ph=" + std::to_wstring(g_set.panelHeight) + L"&team=" + g_set.team;
    if (g_set.background == L"solid") u += L"&bg=solid";
    return u;
}
static void Navigate() {
    if (!g_webview) return;
    std::wstring u = PageUrl();
    if (u == g_loadedUrl) return;
    g_loadedUrl = u;
    g_webview->Navigate(u.c_str());
}

// ---------------------------------------------------------------------------------------------
// Messages from the page: {"type":"size","h":N} and {"type":"open","url":"..."}
// ---------------------------------------------------------------------------------------------
static std::wstring JsonString(const std::wstring& j, const std::wstring& key) {
    size_t k = j.find(L"\"" + key + L"\"");
    if (k == std::wstring::npos) return L"";
    size_t q = j.find(L'"', j.find(L':', k) + 1);
    if (q == std::wstring::npos) return L"";
    std::wstring out;
    for (size_t i = q + 1; i < j.size(); i++) {
        wchar_t c = j[i];
        if (c == L'"') break;
        if (c == L'\\' && i + 1 < j.size()) {
            wchar_t n = j[++i];
            if (n == L'u' && i + 4 < j.size()) { out += (wchar_t)wcstoul(j.substr(i + 1, 4).c_str(), nullptr, 16); i += 4; }
            else out += (n == L'n') ? L'\n' : (n == L't') ? L'\t' : n;
        } else out += c;
    }
    return out;
}
static int JsonInt(const std::wstring& j, const std::wstring& key) {
    size_t k = j.find(L"\"" + key + L"\"");
    if (k == std::wstring::npos) return 0;
    return _wtoi(j.c_str() + j.find(L':', k) + 1);
}

static void OpenUrl(const std::wstring& url) {
    if (url.rfind(L"https://", 0) != 0) return;   // only web pages
    if (!g_set.appCommand.empty()) {
        std::wstring cmd = g_set.appCommand;
        size_t p = cmd.find(L"{url}");
        if (p != std::wstring::npos) cmd.replace(p, 5, url); else cmd += L" " + url;
        STARTUPINFOW si{sizeof(si)};
        PROCESS_INFORMATION pi{};
        if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &si, &pi)) {
            CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
            return;
        }
        Wh_Log(L"App command failed (%lu), using the browser", GetLastError());
    }
    ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
}

static void SetExpanded(bool on, int cssH) {
    g_expanded = on;
    g_cssWant = on ? cssH : g_cssBar;
    if (on) SetTimer(g_hwnd, TIMER_CLICK, 120, nullptr); else KillTimer(g_hwnd, TIMER_CLICK);
    Place();
}
static void Collapse() {
    if (!g_expanded) return;
    if (g_webview) g_webview->ExecuteScript(L"window.Bar && Bar.collapse()", nullptr);
    else SetExpanded(false, 0);
}

static void OnWebMessage(const std::wstring& msg) {
    std::wstring type = JsonString(msg, L"type");
    if (type == L"size") {
        int h = JsonInt(msg, L"h");
        SetExpanded(h > g_cssBar + 2, h);
    } else if (type == L"open") {
        OpenUrl(JsonString(msg, L"url"));
        Collapse();
    }
}

// ---------------------------------------------------------------------------------------------
// WebView2 start-up
// ---------------------------------------------------------------------------------------------
typedef HRESULT(STDAPICALLTYPE* CreateEnvFn)(PCWSTR, PCWSTR, IUnknown*, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
typedef HRESULT(STDAPICALLTYPE* CreateEnvInternalFn)(BOOL, int, PCWSTR, IUnknown*, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
static HMODULE g_loader = nullptr;

// Finds the installed Evergreen runtime's EmbeddedBrowserWebView.dll (what WebView2Loader.dll does).
static std::wstring RuntimeClientDll() {
    const wchar_t* keys[] = {
        L"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        L"SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    };
    HKEY roots[] = {HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER};
    for (HKEY root : roots)
        for (auto key : keys) {
            WCHAR loc[MAX_PATH] = {}, pv[64] = {};
            DWORD n1 = sizeof(loc), n2 = sizeof(pv);
            if (RegGetValueW(root, key, L"location", RRF_RT_REG_SZ, nullptr, loc, &n1) == ERROR_SUCCESS &&
                RegGetValueW(root, key, L"pv", RRF_RT_REG_SZ, nullptr, pv, &n2) == ERROR_SUCCESS && pv[0] && wcscmp(pv, L"0.0.0.0")) {
                std::wstring p = std::wstring(loc) + L"\\" + pv + L"\\EBWebView\\x64\\EmbeddedBrowserWebView.dll";
                if (GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES) return p;
            }
        }
    return L"";
}

static void CreateWebView();
static void OnController(ICoreWebView2Controller* c) {
    g_controller = c; g_controller->AddRef();
    g_controller->get_CoreWebView2(&g_webview);
    ICoreWebView2Controller2* c2 = nullptr;
    if (SUCCEEDED(g_controller->QueryInterface(IID_Controller2, (void**)&c2)) && c2) {
        COREWEBVIEW2_COLOR clear{0, 0, 0, 0};
        c2->put_DefaultBackgroundColor(clear);   // let the taskbar show through
        c2->Release();
    }
    ICoreWebView2Settings* s = nullptr;
    if (SUCCEEDED(g_webview->get_Settings(&s)) && s) {
        s->put_AreDefaultContextMenusEnabled(FALSE);
        s->put_IsStatusBarEnabled(FALSE);
        s->put_IsZoomControlEnabled(FALSE);
        s->put_AreDevToolsEnabled(FALSE);
        s->Release();
    }
    EventRegistrationToken t;
    g_webview->add_WebMessageReceived(new Callback<ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs*>(
        IID_MsgHandler, [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* a) {
            LPWSTR m = nullptr;
            if (SUCCEEDED(a->TryGetWebMessageAsString(&m)) && m) { OnWebMessage(m); CoTaskMemFree(m); }
            return S_OK;
        }), &t);
    // Links the page opens itself go to the app or browser, never a popup over the taskbar.
    g_webview->add_NewWindowRequested(new Callback<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs*>(
        IID_NewWinHandler, [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* a) {
            LPWSTR u = nullptr;
            if (SUCCEEDED(a->get_Uri(&u)) && u) { OpenUrl(u); CoTaskMemFree(u); }
            a->put_Handled(TRUE);
            return S_OK;
        }), &t);
    g_webview->add_ProcessFailed(new Callback<ICoreWebView2ProcessFailedEventHandler, ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*>(
        IID_FailHandler, [](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) {
            Wh_Log(L"WebView2 process failed, restarting");
            PostMessageW(g_hwnd, WM_APP_RELOAD, 1, 0);
            return S_OK;
        }), &t);
    ResizeWebView();
    g_loadedUrl.clear();
    Navigate();
    g_controller->put_IsVisible(TRUE);
}

static void CreateWebView() {
    WCHAR data[MAX_PATH];
    if (FAILED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, data))) return;
    std::wstring folder = std::wstring(data) + L"\\SHUTOUT\\TaskbarWebView";
    SHCreateDirectoryExW(nullptr, folder.c_str(), nullptr);

    auto done = new Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler, HRESULT, ICoreWebView2Environment*>(
        IID_EnvDone, [](HRESULT hr, ICoreWebView2Environment* env) {
            if (FAILED(hr) || !env) { Wh_Log(L"WebView2 environment failed: 0x%08X", (unsigned)hr); return S_OK; }
            env->CreateCoreWebView2Controller(g_hwnd, new Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler, HRESULT, ICoreWebView2Controller*>(
                IID_CtrlDone, [](HRESULT hr2, ICoreWebView2Controller* c) {
                    if (FAILED(hr2) || !c) { Wh_Log(L"WebView2 controller failed: 0x%08X", (unsigned)hr2); return S_OK; }
                    if (g_hwnd) OnController(c);
                    return S_OK;
                }));
            return S_OK;
        });

    HRESULT hr = E_FAIL;
    // 1. The official loader, if it's been put in place (see the Details tab).
    if (!g_loader) g_loader = LoadLibraryW(g_set.loaderPath.c_str());
    if (g_loader) {
        auto create = (CreateEnvFn)GetProcAddress(g_loader, "CreateCoreWebView2EnvironmentWithOptions");
        if (create) hr = create(nullptr, folder.c_str(), nullptr, done);
        Wh_Log(L"Started WebView2 through WebView2Loader.dll: 0x%08X", (unsigned)hr);
    }
    // 2. Otherwise go straight to the installed runtime, the way the loader itself does.
    if (FAILED(hr)) {
        std::wstring dll = RuntimeClientDll();
        HMODULE client = dll.empty() ? nullptr : LoadLibraryW(dll.c_str());
        auto create = client ? (CreateEnvInternalFn)GetProcAddress(client, "CreateWebViewEnvironmentWithOptionsInternal") : nullptr;
        if (create) hr = create(TRUE, 0, folder.c_str(), nullptr, done);
        Wh_Log(L"Started WebView2 from the runtime (%s): 0x%08X", dll.c_str(), (unsigned)hr);
        if (FAILED(hr))
            Wh_Log(L"WebView2 loader missing. Put WebView2Loader.dll at %s (see the Details tab).", g_set.loaderPath.c_str());
    }
    done->Release();
}

static void DestroyWebView() {
    if (g_webview) { g_webview->Release(); g_webview = nullptr; }
    if (g_controller) { g_controller->Close(); g_controller->Release(); g_controller = nullptr; }
    g_loadedUrl.clear();
}

// ---------------------------------------------------------------------------------------------
// The widget window
// ---------------------------------------------------------------------------------------------
static void ApplyBackdrop(HWND h) {
    // Rounded corners and, on 22H2 and later, the acrylic material behind the transparent page.
    DWORD round = 2;  // DWMWCP_ROUND
    DwmSetWindowAttribute(h, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &round, sizeof(round));
    if (g_set.background != L"solid") {
        MARGINS m{-1, -1, -1, -1};
        DwmExtendFrameIntoClientArea(h, &m);
        DWORD backdrop = 3;  // DWMSBT_TRANSIENTWINDOW (acrylic)
        DwmSetWindowAttribute(h, 38 /* DWMWA_SYSTEMBACKDROP_TYPE */, &backdrop, sizeof(backdrop));
    }
    DWORD light = 1, size = sizeof(light);
    RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", L"SystemUsesLightTheme", RRF_RT_REG_DWORD, nullptr, &light, &size);
    BOOL dark = light ? FALSE : TRUE;
    DwmSetWindowAttribute(h, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, &dark, sizeof(dark));
}

static LRESULT CALLBACK WndProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_SIZE: ResizeWebView(); return 0;
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;   // clicking the bar never steals focus from your app
    case WM_ERASEBKGND: {
        // Black is see-through when the frame is extended (acrylic); solid mode paints the taskbar color.
        RECT rc; GetClientRect(h, &rc);
        HBRUSH b = CreateSolidBrush(g_set.background == L"solid" ? RGB(32, 32, 32) : RGB(0, 0, 0));
        FillRect((HDC)wp, &rc, b); DeleteObject(b);
        return 1;
    }
    case WM_TIMER:
        if (wp == TIMER_POS) {
            HWND tb = Taskbar();
            RECT r{}; if (tb) GetWindowRect(tb, &r);
            if (!EqualRect(&r, &g_lastTaskbar) || g_hiddenForFullscreen || (g_set.hideFullscreen && FullscreenAppRunning()) ||
                (tb && TaskbarHidden(tb, r)) || !IsWindowVisible(h))
                Place();
            else SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);  // stay above the taskbar
        } else if (wp == TIMER_CLICK && g_expanded) {
            // A click anywhere outside the open view closes it.
            bool down = (GetAsyncKeyState(VK_LBUTTON) | GetAsyncKeyState(VK_RBUTTON)) & 0x8000;
            static bool wasDown = false;
            if (down && !wasDown) {
                POINT pt; GetCursorPos(&pt);
                RECT wr; GetWindowRect(h, &wr);
                if (!PtInRect(&wr, pt)) Collapse();
            }
            wasDown = down;
        }
        return 0;
    case WM_APP_RELOAD:
        if (wp == 1) { DestroyWebView(); CreateWebView(); }
        else Navigate();
        return 0;
    case WM_SETTINGCHANGE:
    case WM_DPICHANGED:
    case WM_DISPLAYCHANGE:
        ApplyBackdrop(h); Place();
        return 0;
    case WM_CLOSE: DestroyWindow(h); return 0;
    case WM_DESTROY:
        KillTimer(h, TIMER_POS); KillTimer(h, TIMER_CLICK);
        DestroyWebView();
        g_hwnd = nullptr;
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(h, msg, wp, lp);
}

static DWORD WINAPI WidgetThread(LPVOID) {
    CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

    // Explorer may still be building the taskbar at sign-in.
    HWND tb = nullptr;
    for (int i = 0; i < 600 && !(tb = Taskbar()); i++) {
        MSG m; if (PeekMessageW(&m, nullptr, WM_QUIT, WM_QUIT, PM_REMOVE)) { CoUninitialize(); return 0; }
        Sleep(100);
    }
    if (!tb) { Wh_Log(L"No taskbar found"); CoUninitialize(); return 0; }

    WNDCLASSW wc{};
    wc.lpfnWndProc = WndProc;
    wc.hInstance = GetModuleHandleW(nullptr);
    wc.lpszClassName = L"ShutoutTaskbarWidget";
    wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    RegisterClassW(&wc);
    g_hwnd = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE, wc.lpszClassName, L"SHUTOUT",
                             WS_POPUP | WS_CLIPCHILDREN, 0, 0, 100, 48, tb /* owned by the taskbar: stays above it */, nullptr, wc.hInstance, nullptr);
    if (!g_hwnd) { Wh_Log(L"CreateWindow failed: %lu", GetLastError()); CoUninitialize(); return 0; }
    ApplyBackdrop(g_hwnd);
    Place();
    CreateWebView();
    SetTimer(g_hwnd, TIMER_POS, 1000, nullptr);

    MSG m;
    while (GetMessageW(&m, nullptr, 0, 0) > 0) { TranslateMessage(&m); DispatchMessageW(&m); }
    UnregisterClassW(wc.lpszClassName, wc.hInstance);
    CoUninitialize();
    return 0;
}

// ---------------------------------------------------------------------------------------------
// Windhawk entry points
// ---------------------------------------------------------------------------------------------
BOOL Wh_ModInit() {
    Wh_Log(L"SHUTOUT taskbar: init");
    LoadSettings();
    g_thread = CreateThread(nullptr, 0, WidgetThread, nullptr, 0, &g_threadId);
    return g_thread != nullptr;
}

void Wh_ModUninit() {
    Wh_Log(L"SHUTOUT taskbar: uninit");
    if (g_hwnd) PostMessageW(g_hwnd, WM_CLOSE, 0, 0);
    else if (g_threadId) PostThreadMessageW(g_threadId, WM_QUIT, 0, 0);
    if (g_thread) { WaitForSingleObject(g_thread, 5000); CloseHandle(g_thread); g_thread = nullptr; }
    if (g_loader) { FreeLibrary(g_loader); g_loader = nullptr; }
}

void Wh_ModSettingsChanged() {
    LoadSettings();
    if (g_hwnd) { PostMessageW(g_hwnd, WM_SETTINGCHANGE, 0, 0); PostMessageW(g_hwnd, WM_APP_RELOAD, 0, 0); }
}
