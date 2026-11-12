package no.adiam.wadrunner;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Fullscreen landscape host for the bundled WAD Runner web app.
 * - immersive mode (system bars hidden, swipe to peek)
 * - Back button opens the in-game menu (window.wadBack) instead of closing the app
 * - tells the page when the app goes to / returns from the background
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GameScreenPlugin.class);
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        enterImmersive();

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge != null ? bridge.getWebView() : null;
                if (web == null) {
                    finish();
                    return;
                }
                web.evaluateJavascript("(window.wadBack && window.wadBack()) ? 'y' : 'n'", value -> {
                    if (!"\"y\"".equals(value)) finish();
                });
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    @Override
    public void onPause() {
        runJs("window.wadAppPause && window.wadAppPause()");
        super.onPause();
    }

    @Override
    public void onResume() {
        super.onResume();
        enterImmersive();
        runJs("window.wadAppResume && window.wadAppResume()");
    }

    private void runJs(String js) {
        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web != null) web.evaluateJavascript(js, null);
    }

    private void enterImmersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
