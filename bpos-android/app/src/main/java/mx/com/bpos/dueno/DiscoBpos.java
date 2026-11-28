package mx.com.bpos.dueno;

import android.content.Context;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * Lo que B-POS guardaba en la memoria del navegador (~5 MB, se llenaba) se
 * guarda aquí, en archivos del teléfono: uno por cada dato (bpos_orders,
 * bpos_inventory_kardex, ...). La página lo lee todo al abrir (cargar) y
 * cada cambio se escribe en segundo plano, en orden.
 */
public class DiscoBpos {
    private final File dir;
    private final Map<String, String> cache = new HashMap<>();
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();

    /** Cambio pendiente de escribir: key == null es "borrar todo"; value == null es "borrar ese dato" */
    private static final class Op {
        final String key;
        final String value;

        Op(String key, String value) {
            this.key = key;
            this.value = value;
        }
    }

    private final List<Op> ops = new ArrayList<>();
    private boolean scheduled = false;

    public DiscoBpos(Context context) {
        dir = new File(context.getFilesDir(), "bpos-datos");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.getName().endsWith(".tmp")) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
                continue;
            }
            try {
                String key = URLDecoder.decode(f.getName(), "UTF-8");
                cache.put(key, new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            } catch (Exception ignored) {
                // archivo dañado: se ignora (la nube lo vuelve a bajar)
            }
        }
    }

    private File fileFor(String key) {
        try {
            return new File(dir, URLEncoder.encode(key, "UTF-8"));
        } catch (Exception e) {
            return new File(dir, Integer.toHexString(key.hashCode()));
        }
    }

    /** Todo lo guardado, como JSON { clave: valor } */
    @JavascriptInterface
    public String cargar() {
        synchronized (lock) {
            return new JSONObject(cache).toString();
        }
    }

    @JavascriptInterface
    public void guardar(String key, String value) {
        queue(new Op(key, value));
    }

    @JavascriptInterface
    public void borrar(String key) {
        queue(new Op(key, null));
    }

    @JavascriptInterface
    public void vaciar() {
        queue(new Op(null, null));
    }

    private void queue(Op op) {
        synchronized (lock) {
            if (op.key == null) {
                cache.clear();
                ops.clear();
            } else {
                if (op.value == null) cache.remove(op.key);
                else cache.put(op.key, op.value);
                // Solo cuenta el último valor de cada dato
                ops.removeIf(o -> o.key != null && o.key.equals(op.key));
            }
            ops.add(op);
            if (!scheduled) {
                scheduled = true;
                writer.execute(this::drain);
            }
        }
    }

    private void drain() {
        List<Op> batch;
        synchronized (lock) {
            batch = new ArrayList<>(ops);
            ops.clear();
            scheduled = false;
        }
        for (Op op : batch) {
            try {
                if (op.key == null) {
                    File[] files = dir.listFiles();
                    if (files != null) for (File f : files) //noinspection ResultOfMethodCallIgnored
                        f.delete();
                } else if (op.value == null) {
                    //noinspection ResultOfMethodCallIgnored
                    fileFor(op.key).delete();
                } else {
                    write(fileFor(op.key), op.value);
                }
            } catch (Exception ignored) {
                // sin espacio o error de disco: el dato sigue en memoria y en la nube
            }
        }
    }

    /** Escribe a un temporal y lo cambia de nombre: nunca queda un archivo a medias */
    private void write(File target, String value) throws IOException {
        File tmp = new File(dir, target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(value.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(target)) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            if (!tmp.renameTo(target)) throw new IOException("no se pudo guardar " + target.getName());
        }
    }

    /** Espera a que se escriba lo pendiente (al salir de la app) */
    public void esperar() {
        try {
            writer.submit(() -> { }).get(3, TimeUnit.SECONDS);
        } catch (Exception ignored) {
        }
    }
}
