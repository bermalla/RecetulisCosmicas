# Mi Recetario

Web app para guardar recetas y descubrir qué cocinar según los ingredientes
disponibles. La colección se inicia completamente vacía: no hay recetas de
ejemplo ni datos precargados en el repositorio.

## Funcionalidades

- Carga manual de recetas con ingredientes, instrucciones y datos opcionales.
- Importación de una o varias recetas desde JSON.
- Exportación íntegra de la colección como respaldo JSON.
- Filtro por ingredientes disponibles, priorizando las coincidencias completas.
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

El botón **Exportar base** descarga un respaldo portable con toda la colección.
La importación acepta ese mismo respaldo o un objeto con esta estructura:

```ts
type RecipeImport = {
  recipes: Array<{
    name: string;
    description?: string;
    instructions: string;
    durationMinutes?: number;
    servings?: number;
    nutrients?: string[];
    ingredients: Array<{
      name: string;
      quantity?: number;
      unit?: string;
      notes?: string;
    }>;
  }>;
};
```

## Publicación

El proyecto está preparado para desplegarse en Cloudflare mediante la
configuración de Sites incluida. Para publicarlo desde otro entorno es necesario
crear o asociar una base D1 y conservar los nombres de los bindings declarados.

> La base de producción no vive en GitHub. Sin una integración adicional, las
> recetas agregadas desde la web no modifican el repositorio. La exportación JSON
> sirve como respaldo hasta definir una arquitectura de datos definitiva.
