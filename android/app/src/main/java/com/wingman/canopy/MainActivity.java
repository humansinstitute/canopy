package com.wingman.canopy;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.util.*;

public class MainActivity extends ComponentActivity {
    private WebView web;
    private android.content.SharedPreferences account;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Pending pending;
    private ValueCallback<Uri[]> fileCallback;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private FrameLayout root;
    private String delayedLink;
    private final Runnable timeout = () -> fail("Amber request expired. Try again.");
    private static class Pending {
        String id, type, user;
        JavaScriptReplyProxy reply;
        Pending(String id, String type, String user, JavaScriptReplyProxy reply) { this.id=id; this.type=type; this.user=user; this.reply=reply; }
    }
    private final ActivityResultLauncher<Intent> signer = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
        if (pending == null) return; // Old activity/process result has no live JS request.
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) { fail("Amber did not complete the request. Try again."); return; }
        if (!pending.id.equals(data.getStringExtra("id"))) { fail("Amber response did not match the request."); return; }
        if (data.getBooleanExtra("rejected", false)) { fail("Request declined in Amber."); return; }
        String value = data.getStringExtra("result");
        if ("get_public_key".equals(pending.type)) {
            String pkg = data.getStringExtra("package");
            if (!SignerPolicy.key(value) || !SignerPolicy.AMBER.equals(pkg)) { fail("Amber returned an invalid account or package."); return; }
            account.edit().putString("pubkey", value).apply();
        } else {
            if (!Objects.equals(pending.user, account.getString("pubkey", null))) { fail("Account changed. Reconnect to Amber."); return; }
            if ("sign_event".equals(pending.type)) value = data.getStringExtra("event");
        }
        if (value == null || value.length() > 500_000) { fail("Amber returned an invalid response."); return; }
        respond(value, null);
    });
    private final ActivityResultLauncher<Intent> files = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
        if (fileCallback != null) { fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData())); fileCallback=null; }
    });
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        account = getSharedPreferences("amber-account", MODE_PRIVATE);
        root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web);
        LinearLayout layout = new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);
        Button accountButton = new Button(this); accountButton.setText("Canopy · Amber account");
        accountButton.setOnClickListener(v -> { PopupMenu menu = new PopupMenu(this, accountButton); menu.getMenu().add("Switch Amber account").setOnMenuItemClickListener(item -> { switchAccount(); return true; }); menu.show(); });
        layout.addView(accountButton, new LinearLayout.LayoutParams(-1,48 * (int)getResources().getDisplayMetrics().density));
        layout.addView(root, new LinearLayout.LayoutParams(-1,0,1));
        setContentView(layout);
        // Fit system bars and keyboard without hiding web controls.
        layout.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
            v.setPadding(bars.left,bars.top,bars.right,bars.bottom); return insets;
        });
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            TextView error = new TextView(this); error.setText("Update Android System WebView to use Canopy safely."); setContentView(error); return;
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/", path -> {
            String file = path.isEmpty() || !path.contains(".") ? "index.html" : path;
            if (file.contains("..")) return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Map.of(), new ByteArrayInputStream(new byte[0]));
            try {
                String mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".html") ? "text/html" : MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(file));
                return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", getAssets().open("www/"+file));
            } catch (IOException e) { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(), new ByteArrayInputStream(new byte[0])); }
        }).build();
        WebViewCompat.addWebMessageListener(web, "canopyAmber", Set.of(SignerPolicy.ORIGIN), (view, message, origin, mainFrame, reply) -> {
            if (!mainFrame || !SignerPolicy.trusted(origin.toString()) || !SignerPolicy.trusted(web.getUrl())) return;
            receive(message.getData(), reply);
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) { return loader.shouldInterceptRequest(req.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                String url = req.getUrl().toString();
                if (SignerPolicy.trusted(url)) return false;
                if (req.isForMainFrame() && req.hasGesture()) openExternal(url);
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { fail("Page changed. Request cancelled."); }
            @Override public void onPageFinished(WebView view, String url) { if (delayedLink != null) { deliverLink(delayedLink); delayedLink=null; } }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback=callback;
                try { files.launch(params.createIntent()); } catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback=null; }
                return true;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) { if (fullscreen != null) { callback.onCustomViewHidden(); return; } fullscreen=view; fullscreenCallback=callback; root.addView(view); web.setVisibility(View.GONE); }
            @Override public void onHideCustomView() { hideFullscreen(); }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) {
                if (!gesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() { @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) { openExternal(req.getUrl().toString()); popup.destroy(); return true; } });
                ((WebView.WebViewTransport)result.obj).setWebView(popup); result.sendToTarget(); return true;
            }
        });
        settings.setSupportMultipleWindows(true);
        web.setDownloadListener((url, agent, disposition, mime, length) -> openExternal(url));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { if (fullscreen != null) hideFullscreen(); else if (web.canGoBack()) web.goBack(); else finish(); }
        });
        delayedLink = getIntent().getDataString();
        String initial = SignerPolicy.ORIGIN + "/";
        if (delayedLink != null) { initial += "?canopyLink=" + Uri.encode(delayedLink); delayedLink=null; }
        if (state != null && SignerPolicy.trusted(state.getString("page", ""))) initial=state.getString("page");
        web.loadUrl(initial);
    }
    private void receive(String raw, JavaScriptReplyProxy reply) {
        String id = "";
        try {
            if (raw == null || raw.length() > 500_000) throw new IllegalArgumentException("Request too large.");
            JSONObject request = new JSONObject(raw);
            id=request.getString("id");
            if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid request identifier.");
            String type=request.getString("type");
            if (!SignerPolicy.method(type)) throw new IllegalArgumentException("Unsupported signer method.");
            if (pending != null) throw new IllegalArgumentException("Another Amber request is open. Finish it first.");
            String user=account.getString("pubkey", null);
            if ("get_public_key".equals(type) && SignerPolicy.key(user)) { send(reply,id,user,null); return; }
            if (!"get_public_key".equals(type) && (!SignerPolicy.key(user) || !user.equals(request.optString("current_user")))) throw new IllegalArgumentException("Account changed. Connect to Amber again.");
            String payload=request.optString("payload", "");
            if (type.startsWith("nip44_") && !SignerPolicy.key(request.optString("pubkey"))) throw new IllegalArgumentException("Invalid encryption peer.");
            if ("sign_event".equals(type) && !user.equals(new JSONObject(payload).getString("pubkey"))) throw new IllegalArgumentException("Wrong signing account.");
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:"+payload));
            intent.setPackage(SignerPolicy.AMBER);
            intent.putExtra("type",type); intent.putExtra("id",id);
            if (user != null) intent.putExtra("current_user",user);
            if (request.has("pubkey")) intent.putExtra("pubkey",request.getString("pubkey"));
            if (intent.resolveActivity(getPackageManager()) == null) throw new IllegalArgumentException("Install or enable Amber to sign in. Keys stay in Amber.");
            pending=new Pending(id,type,user,reply);
            handler.postDelayed(timeout,120_000);
            signer.launch(intent);
        } catch (Exception e) {
            if (pending != null && pending.id.equals(id)) fail("Unable to open Amber. Try again.");
            else send(reply,id,null,e.getMessage() == null ? "Invalid Amber request." : e.getMessage());
        }
    }
    private void send(JavaScriptReplyProxy reply, String id, String value, String error) {
        try { JSONObject json=new JSONObject(); json.put("id",id); if(error!=null) json.put("error",error); else json.put("result",value); reply.postMessage(json.toString()); } catch (Exception ignored) { /* Page/process no longer exists. */ }
    }
    private void respond(String value, String error) { if(pending==null)return; Pending p=pending; pending=null; handler.removeCallbacks(timeout); send(p.reply,p.id,value,error); }
    private void fail(String error) { respond(null,error); }
    private void openExternal(String url) { if (!SignerPolicy.external(url)) return; try { startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); } catch(ActivityNotFoundException e) { Toast.makeText(this,"No app can open this link.",Toast.LENGTH_SHORT).show(); } }
    private void hideFullscreen() { if (fullscreen == null) return; root.removeView(fullscreen); fullscreen=null; web.setVisibility(View.VISIBLE); fullscreenCallback.onCustomViewHidden(); fullscreenCallback=null; }
    @Override protected void onSaveInstanceState(Bundle state) { if(web!=null && SignerPolicy.trusted(web.getUrl())) state.putString("page",web.getUrl()); super.onSaveInstanceState(state); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); if(intent.getDataString()!=null) deliverLink(intent.getDataString()); }
    private void deliverLink(String link) { if (web != null && SignerPolicy.trusted(web.getUrl())) web.evaluateJavascript("window.canopyOpenLink?.("+JSONObject.quote(link)+")",null); }
    @Override public boolean onCreateOptionsMenu(Menu menu) { menu.add("Switch Amber account").setOnMenuItemClickListener(item -> { switchAccount(); return true; }); return true; }
    private void switchAccount() { fail("Account changed. Reconnect to Amber."); account.edit().clear().apply(); web.evaluateJavascript("localStorage.removeItem('canopy.rememberLogin'); location.href='/'",null); }
    @Override protected void onDestroy() { fail("Canopy was closed. Try again."); if(fileCallback!=null)fileCallback.onReceiveValue(null); handler.removeCallbacksAndMessages(null); if(web!=null)web.destroy(); super.onDestroy(); }
}
