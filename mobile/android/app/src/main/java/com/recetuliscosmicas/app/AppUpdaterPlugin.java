package com.recetuliscosmicas.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String RELEASE_CERT_SHA256 = "9d223a20b7677305be1c85ff535195ab64846a5c6aea66b750527b9231ed8fe7";

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String expectedSha = call.getString("sha256", "").replace(":", "").toLowerCase(Locale.ROOT);
        if (!url.startsWith("https://") || !expectedSha.matches("[0-9a-f]{64}")) {
            call.reject("La actualización no tiene una dirección o firma válida.");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            permission.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(permission);
            call.reject("Habilitá la instalación de actualizaciones para Recetulis y volvé a intentarlo.");
            return;
        }

        new Thread(() -> downloadAndInstall(call, url, expectedSha), "recetulis-updater").start();
    }

    private void downloadAndInstall(PluginCall call, String source, String expectedSha) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(source);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("El servidor no entregó la actualización.");
            }
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength <= 0 || declaredLength > 100L * 1024L * 1024L) {
                throw new IllegalStateException("La actualización tiene un tamaño inesperado.");
            }

            File apk = new File(getContext().getCacheDir(), "recetulis-update.apk");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk, false)) {
                byte[] buffer = new byte[32768];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > 100L * 1024L * 1024L) throw new IllegalStateException("La actualización supera el tamaño permitido.");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
            }
            if (total != declaredLength) throw new IllegalStateException("La descarga quedó incompleta.");
            StringBuilder actualSha = new StringBuilder();
            for (byte value : digest.digest()) actualSha.append(String.format(Locale.ROOT, "%02x", value));
            if (!actualSha.toString().equals(expectedSha)) {
                apk.delete();
                throw new SecurityException("La firma de integridad de la actualización no coincide.");
            }

            verifyPackage(apk);
            Uri contentUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(contentUri, "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installer);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "No se pudo instalar la actualización." : error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(File apk) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), 0);
        if (candidate == null || !getContext().getPackageName().equals(candidate.packageName)) {
            throw new SecurityException("La actualizacion no pertenece a Recetulis.");
        }
        long candidateVersion = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? candidate.getLongVersionCode()
            : candidate.versionCode;
        long installedVersion = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? installed.getLongVersionCode()
            : installed.versionCode;
        if (candidateVersion <= installedVersion) {
            throw new SecurityException("La actualizacion no es una version posterior.");
        }
        Signature[] signatures = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? candidate.signingInfo.getApkContentsSigners()
            : candidate.signatures;
        if (signatures == null || signatures.length != 1) {
            throw new SecurityException("La actualizacion no tiene la firma esperada.");
        }
        byte[] certificate = MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray());
        StringBuilder certificateSha = new StringBuilder();
        for (byte value : certificate) certificateSha.append(String.format(Locale.ROOT, "%02x", value));
        if (!RELEASE_CERT_SHA256.equals(certificateSha.toString())) {
            throw new SecurityException("La actualizacion no fue firmada por Recetulis.");
        }
    }
}
