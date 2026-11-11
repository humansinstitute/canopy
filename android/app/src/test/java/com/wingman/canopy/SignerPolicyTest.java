package com.wingman.canopy;
import org.junit.Test;
import static org.junit.Assert.*;
public class SignerPolicyTest {
    @Test public void onlyExactBundledOriginIsTrusted() {
        assertTrue(SignerPolicy.trusted(SignerPolicy.ORIGIN+"/feed"));
        for (String url : new String[]{"http://appassets.androidplatform.net", "https://appassets.androidplatform.net.evil.test", "https://appassets.androidplatform.net@evil.test", "https://evil@appassets.androidplatform.net", "https://appassets.androidplatform.net:443", "file:///android_asset/index.html", "https://example.com", "javascript:alert(1)"}) assertFalse(url, SignerPolicy.trusted(url));
    }
    @Test public void noArbitraryIntentOrMethodForwarding() {
        assertTrue(SignerPolicy.method("sign_event")); assertTrue(SignerPolicy.method("nip44_decrypt"));
        assertFalse(SignerPolicy.method("get_private_key")); assertFalse(SignerPolicy.method("connect"));
        assertFalse(SignerPolicy.external("intent://arbitrary")); assertFalse(SignerPolicy.external("javascript:alert(1)"));
        assertTrue(SignerPolicy.external("lightning:lnbc1test"));
        assertFalse(SignerPolicy.key("nsec1secret")); assertTrue(SignerPolicy.key("a".repeat(64)));
    }
}
