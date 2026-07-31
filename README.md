# Recetulis Cósmicas

Web app para guardar recetas y descubrir qué cocinar según los ingredientes
disponibles. La colección se inicia completamente vacía: no hay recetas de
ejemplo ni datos precargados en el repositorio.

## Funcionalidades

- Carga manual de recetas con ingredientes, instrucciones y datos opcionales.
- Importación de una o varias recetas desde JSON, con revisión previa de duplicados.
- Exportación íntegra de la colección como respaldo JSON.
- Filtro que arranca vacío y prioriza las coincidencias completas.
- Agua, sal, azúcar, pimienta y aceite neutro se asumen disponibles y no afectan
  el conteo de faltantes.
- Categorías generales inferidas automáticamente para reconocer cada tipo de receta.
- Referencias automáticas de nutrientes a partir de los ingredientes obligatorios.
- Área **Mis recetas** con búsqueda por nombre y eliminación de recetas.
- Persistencia en Cloudflare D1.

## Tecnología

- React, TypeScript y Next.js sobre [Vinext](https://github.com/cloudflare/vinext)
- Cloudflare Workers y D1
- Drizzle ORM

## Desarrollo local

Requisitos:

- Node.js `>=22.13.0`
- npm
- Linux o WSL para los scripts auxiliares incluidos

```bash
npm ci
npm run dev
```

El servidor indicará la URL local disponible. La configuración de bindings está
declarada en `.openai/hosting.json` y el esquema se encuentra en
`db/schema.ts`.

## Comandos

```bash
npm run dev          # desarrollo local
npm test             # compila y valida el artefacto
npm run build        # build de producción
npm run db:generate  # genera migraciones después de cambiar el esquema
```

## Datos

Las recetas no forman parte del código fuente. En ejecución, la fuente de verdad
es la base D1 asociada al despliegue. Una instalación nueva comienza sin
recetas y se completa desde la interfaz.

La carpeta `recetas-json/` funciona únicamente como archivo personal de lotes
JSON. La aplicación no la lee ni importa su contenido automáticamente.

La carpeta `Recursos recetas/` está destinada a PDFs y otros materiales fuente
que se quieran convertir posteriormente al formato JSON de la aplicación.

El botón **Exportar base** descarga un respaldo portable con toda la colección.
La importación acepta ese mismo respaldo o un objeto con esta estructura:

```ts
type RecipeImport = {
  recipes: Array<{
    name: string;
    description?: string;
    category?: string;
    instructions: string;
    durationMinutes?: number;
    servings?: number;
    nutrients?: string[];
    ingredients: Array<{
      name: string;
      quantity?: string | number | null;
      unit?: string | null;
      optional?: boolean;
    }>;
  }>;
};
```

Antes de escribir en la base, la API revisa el lote completo. Bloquea nombres
repetidos sin distinguir mayúsculas o acentos, identificadores ya existentes y
recetas con los mismos ingredientes e instrucciones. Si encuentra una
coincidencia, no guarda ninguna receta del lote.

## Referencias nutricionales

Al guardar o leer una receta, la app relaciona sus ingredientes obligatorios
con estas referencias: zinc, selenio, ácido fólico, vitaminas C, E y D,
coenzima Q10, yodo, hierro y Omega 3. Las etiquetas señalan presencia habitual;
no calculan cantidades, biodisponibilidad ni necesidades individuales.

Las reglas se basan en fuentes generales como
[USDA FoodData Central](https://fdc.nal.usda.gov/), las
[fichas del Office of Dietary Supplements de NIH](https://ods.od.nih.gov/factsheets/list-VitaminsMinerals/)
y la revisión sobre
[contenido alimentario de coenzima Q10](https://pubmed.ncbi.nlm.nih.gov/20301015/).

## Publicación

El proyecto está preparado para desplegarse en Cloudflare mediante la
configuración de Sites incluida. Para publicarlo desde otro entorno es necesario
crear o asociar una base D1 y conservar los nombres de los bindings declarados.

> La base de producción no vive en GitHub. Sin una integración adicional, las
> recetas agregadas desde la web no modifican el repositorio. La exportación JSON
> sirve como respaldo hasta definir una arquitectura de datos definitiva.
