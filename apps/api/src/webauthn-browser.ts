/**
 * Deliberately dependency-free WebAuthn enrollment client. The server remains the
 * authority for RP ID, origin, user verification, challenge lifetime, and policy.
 * Pending ceremony and recovery material stay in this page's memory only.
 */
export const webAuthnEnrollmentBrowserScript = String.raw`(() => {
  "use strict";

  const form = document.getElementById("passkey-enrollment");
  const status = document.getElementById("passkey-status");
  const recovery = document.getElementById("passkey-recovery");
  const recoveryCodes = document.getElementById("passkey-recovery-codes");
  const acknowledged = document.getElementById("passkey-recovery-acknowledged");
  const complete = document.getElementById("passkey-complete");
  let pending;

  if (!form || !status || !recovery || !recoveryCodes || !acknowledged || !complete) return;

  function decodeBase64Url(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = window.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function encodeBase64Url(value) {
    const bytes = new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function browserOptions(options) {
    return {
      ...options,
      challenge: decodeBase64Url(options.challenge),
      excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
        ...credential,
        id: decodeBase64Url(credential.id),
      })),
      user: { ...options.user, id: decodeBase64Url(options.user.id) },
    };
  }

  function serializeCredential(credential) {
    const response = credential.response;
    const serialized = {
      id: credential.id,
      rawId: encodeBase64Url(credential.rawId),
      response: {
        attestationObject: encodeBase64Url(response.attestationObject),
        clientDataJSON: encodeBase64Url(response.clientDataJSON),
        ...(typeof response.getTransports === "function"
          ? { transports: response.getTransports() }
          : {}),
        ...(typeof response.getAuthenticatorData === "function"
          ? { authenticatorData: encodeBase64Url(response.getAuthenticatorData()) }
          : {}),
        ...(typeof response.getPublicKey === "function" && response.getPublicKey()
          ? { publicKey: encodeBase64Url(response.getPublicKey()) }
          : {}),
        ...(typeof response.getPublicKeyAlgorithm === "function"
          ? { publicKeyAlgorithm: response.getPublicKeyAlgorithm() }
          : {}),
      },
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      type: credential.type,
    };
    return serialized;
  }

  async function request(path, body) {
    const response = await fetch(path, {
      body: JSON.stringify(body),
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Passkey enrollment was not completed.");
    return data;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    pending = undefined;
    recovery.hidden = true;
    recoveryCodes.replaceChildren();
    acknowledged.checked = false;
    status.textContent = "Preparing Windows Hello or your passkey provider…";
    const values = new FormData(form);
    const password = String(values.get("currentPassword") || "");
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) {
        throw new Error("This browser does not support passkeys.");
      }
      const prepared = await request("/auth/security/webauthn/prepare", {
        credentialName: String(values.get("credentialName") || ""),
        currentPassword: password,
      });
      form.elements.currentPassword.value = "";
      for (const code of prepared.recoveryCodes) {
        const item = document.createElement("li");
        const codeElement = document.createElement("code");
        codeElement.textContent = code;
        item.append(codeElement);
        recoveryCodes.append(item);
      }
      recovery.hidden = false;
      const credential = await navigator.credentials.create({
        publicKey: browserOptions(prepared.options),
      });
      if (!credential) throw new Error("The passkey provider did not return a credential.");
      pending = {
        ceremonyId: prepared.ceremonyId,
        response: serializeCredential(credential),
      };
      status.textContent = "Passkey created. Save every recovery code, then finish enrollment.";
    } catch (error) {
      form.elements.currentPassword.value = "";
      pending = undefined;
      status.textContent = error instanceof Error ? error.message : "Passkey enrollment failed.";
    }
  });

  complete.addEventListener("click", async () => {
    if (!pending || !acknowledged.checked) {
      status.textContent = "Confirm that you saved every recovery code.";
      return;
    }
    complete.disabled = true;
    try {
      await request("/auth/security/webauthn/complete", {
        ...pending,
        recoveryCodesAcknowledged: true,
      });
      pending = undefined;
      recoveryCodes.replaceChildren();
      window.location.assign("/login");
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Passkey enrollment failed.";
      complete.disabled = false;
    }
  });
})();`;
