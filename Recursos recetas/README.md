# Recursos recetas

Esta carpeta reúne materiales fuente para convertirlos gradualmente al formato
de Recetulis Cósmicas. Su contenido no se carga automáticamente en la aplicación.

## Organización

- `PDFs pendientes/`: documentos originales todavía no procesados.
- `PDFs procesados/`: documentos originales que ya cuentan con un JSON convertido.
- `JSON convertidos/`: archivos resultantes, listos para revisar o importar.

Al convertir un PDF conviene conservar, cuando estén disponibles:

- nombre y descripción de la receta;
- ingredientes con cantidad, unidad y condición de opcional;
- pasos de preparación;
- duración y porciones;
- fuente o página de origen.

Antes de importar un JSON convertido, la aplicación hará la revisión habitual
de duplicados.

## Lotes convertidos

- `JSON convertidos/700-recetas-chau-inflamacion.json`: 716 recetas únicas.
- `JSON convertidos/cuadernillo-formacion-vegana.json`: 92 recetas únicas.

El conversor reproducible está en `scripts/convert_pending_pdfs.py`. Omite las
repeticiones idénticas presentes en los documentos y diferencia los nombres que
coinciden entre ambos lotes para permitir importarlos en una misma colección.
