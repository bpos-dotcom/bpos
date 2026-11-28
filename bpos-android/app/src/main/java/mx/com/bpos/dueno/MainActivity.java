package mx.com.bpos.dueno;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * B-POS Dueño: abre la App del dueño (www.bpos.com.mx/dueno) y, con
 * "B-POS completo", el resto de B-POS en la misma ventana. Siempre es la
 * versión publicada (no hay que reinstalar con cada arreglo). Lo que el
 * navegador guardaba en su memoria se guarda en el teléfono (DiscoBpos).
 */
public class MainActivity extends Activity {
    static final String START_URL = "https://www.bpos.com.mx/dueno";
    static final Set<String> HOSTS = new HashSet<>(Arrays.asList("www.bpos.com.mx", "bpos.com.mx"));
    static final String VERSION = "1.0";
    private static final int PICK_FILE = 41;

    private WebView web;
    private DiscoBpos disco;
    private ValueCallback<Uri[]> fileCallback;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        disco = new DiscoBpos(getApplicationContext());
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // la voz y el sonido de los avisos
        s.setUserAgentString(s.getUserAgentString() + " BPOSDueno/" + VERSION);
        web.addJavascriptInterface(disco, "BposDisco");

        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Set<String> origins = new HashSet<>();
            for (String h : HOSTS) origins.add("https://" + h);
            WebViewCompat.addDocumentStartJavaScript(web, readAsset("disco.js"), origins);
        } else {
            Toast.makeText(this, "Actualiza \"Android System WebView\" en Play Store: sin eso B-POS guarda en la memoria del navegador.", Toast.LENGTH_LONG).show();
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if ("https".equals(url.getScheme()) && HOSTS.contains(url.getHost())) return false;
                // WhatsApp, teléfono, correo, mapas, Mercado Pago...: en su app
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), PICK_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) web.loadUrl(START_URL);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        disco.esperar(); // que no se pierda lo último que guardó B-POS
    }

    @Override
    protected void onDestroy() {
        disco.esperar();
        web.destroy();
        super.onDestroy();
    }
}
