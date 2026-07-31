"""Convert the recipe PDFs in ``Recursos recetas/PDFs pendientes`` to importable JSON.

The two source documents use different layouts:

* ``700RecetasChauInflamacion.pdf`` has one recipe per page and two fixed columns.
* ``cuadernillo de formacion vegana edit.pdf`` is a course booklet with several
  recipes per page, so its recipe headings are listed explicitly below.

Run from the repository root with ``python scripts/convert_pending_pdfs.py``.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
PENDING = ROOT / "Recursos recetas" / "PDFs pendientes"
PROCESSED = ROOT / "Recursos recetas" / "PDFs procesados"
OUTPUT = ROOT / "Recursos recetas" / "JSON convertidos"


def source_pdf(filename: str) -> Path:
    processed = PROCESSED / filename
    return processed if processed.exists() else PENDING / filename


BIG_PDF = source_pdf("700RecetasChauInflamacion.pdf")
VEGAN_PDF = source_pdf("cuadernillo de formacion vegana edit.pdf")

SECTION_PAGES = {149, 405, 529, 632, 662, 675, 729}

UNITS = {
    "cc": "cc",
    "cm": "cm",
    "g": "g",
    "gr": "g",
    "grs": "g",
    "gramo": "g",
    "gramos": "g",
    "kg": "kg",
    "kilo": "kg",
    "kilos": "kg",
    "ml": "ml",
    "litro": "litro",
    "litros": "litros",
    "taza": "taza",
    "tazas": "tazas",
    "cucharada": "cucharada",
    "cucharadas": "cucharadas",
    "cucharadita": "cucharadita",
    "cucharaditas": "cucharaditas",
    "cdta": "cucharadita",
    "cdtas": "cucharaditas",
    "cda": "cucharada",
    "cdas": "cucharadas",
    "unidad": "unidad",
    "unidades": "unidades",
    "diente": "diente",
    "dientes": "dientes",
    "rodaja": "rodaja",
    "rodajas": "rodajas",
    "hoja": "hoja",
    "hojas": "hojas",
    "gota": "gota",
    "gotas": "gotas",
    "pizca": "pizca",
    "pizcas": "pizcas",
    "paquete": "paquete",
    "paquetes": "paquetes",
    "lata": "lata",
    "latas": "latas",
    "filete": "filete",
    "filetes": "filetes",
    "rama": "rama",
    "ramas": "ramas",
    "manojo": "manojo",
    "manojos": "manojos",
    "bloque": "bloque",
    "bloques": "bloques",
    "sobre": "sobre",
    "sobres": "sobres",
    "cabeza": "cabeza",
    "cabezas": "cabezas",
    "puñado": "puñado",
    "puñados": "puñados",
    "lámina": "lámina",
    "láminas": "láminas",
}

QUANTITY_WORDS = {
    "un": "1",
    "una": "1",
    "dos": "2",
    "tres": "3",
    "cuatro": "4",
    "cinco": "5",
    "seis": "6",
    "media": "1/2",
    "medio": "1/2",
}

QTY_PATTERN = re.compile(
    r"^(?P<qty>"
    r"\d+\s+y\s+\d+\s*/\s*\d+|"
    r"\d+\s+\d+\s*/\s*\d+|"
    r"\d+\s*/\s*\d+|"
    r"\d+(?:[.,]\d+)?(?:\s*(?:a|-)\s*\d+(?:[.,]\d+)?)?|"
    r"[¼½¾]|un(?:a)?\b|dos\b|tres\b|cuatro\b|cinco\b|seis\b|media\b|medio\b"
    r")\s*(?P<rest>.*)$",
    re.IGNORECASE,
)


def clean_text(value: str) -> str:
    replacements = {
        "\x00": "ti",
        "\ufb00": "ff",
        "\ufb01": "fi",
        "\ufb02": "fl",
        "\ufb03": "ffi",
        "\ufb04": "ffl",
        "\u00a0": " ",
        "–": "-",
        "—": "-",
    }
    for old, new in replacements.items():
        value = value.replace(old, new)
    return re.sub(r"[ \t]+", " ", value).strip()


def display_name(value: str) -> str:
    value = clean_text(value).replace("\n", " ")
    value = re.sub(r"\s+", " ", value).strip(" .")
    if value.upper() == value:
        value = value.lower()
    return value[:1].upper() + value[1:]


def normalized_key(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFD", value).lower()
        if unicodedata.category(char) != "Mn" and char.isalnum()
    )


def split_instructions(value: str) -> list[str]:
    value = clean_text(value.replace("\n", " "))
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return []
    parts = re.split(r"(?<=[.!?;])\s+(?=[A-ZÁÉÍÓÚÑ])", value)
    instructions = [part.strip() for part in parts if part.strip()]
    return [display_name(part) if part.upper() == part else part for part in instructions]


def parse_quantity(value: str) -> tuple[str | None, str | None, str]:
    value = clean_text(value).strip(" -•\t")
    match = QTY_PATTERN.match(value)
    if not match:
        return None, None, value

    raw_quantity = re.sub(r"\s+", " ", match.group("qty").lower()).strip()
    quantity = QUANTITY_WORDS.get(raw_quantity, raw_quantity.replace(",", "."))
    quantity = {"¼": "1/4", "½": "1/2", "¾": "3/4"}.get(quantity, quantity)
    rest = match.group("rest").strip()
    rest = re.sub(r"^de\s+", "", rest, flags=re.IGNORECASE)

    unit = None
    unit_match = re.match(r"^([\wáéíóúñ]+)(?:\s*\([^)]*\))?\s+(.*)$", rest, re.IGNORECASE)
    if unit_match:
        candidate = unit_match.group(1).lower()
        if candidate in UNITS:
            unit = UNITS[candidate]
            rest = unit_match.group(2).strip()
            fraction_match = re.match(r"^y\s+(media|medio|\d+\s*/\s*\d+)\s+de\s+(.*)$", rest, re.I)
            if fraction_match:
                fraction = QUANTITY_WORDS.get(
                    fraction_match.group(1).lower(), fraction_match.group(1).replace(" ", "")
                )
                quantity = f"{quantity} {fraction}"
                rest = fraction_match.group(2).strip()
            rest = re.sub(r"^de\s+", "", rest, flags=re.IGNORECASE)
    return quantity, unit, rest


def ingredient_from_text(value: str) -> dict[str, Any] | None:
    value = clean_text(value).strip(" -•.;")
    if not value:
        return None

    optional = bool(re.search(r"\bopcional\b", value, re.IGNORECASE))
    value = re.sub(r"^opcional\s*:?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*\(?opcional\)?\.?$", "", value, flags=re.IGNORECASE).strip()

    # The extra-recipes section sometimes writes "ingredient: quantity".
    if ":" in value and not QTY_PATTERN.match(value):
        name_part, quantity_part = value.split(":", 1)
        quantity, unit, rest = parse_quantity(quantity_part)
        if quantity:
            name = clean_text(name_part)
            if rest and not rest.startswith("("):
                name = f"{name} {rest}"
            return {
                "name": name.lower(),
                "quantity": quantity,
                "unit": unit,
                "optional": optional,
            }

    quantity, unit, name = parse_quantity(value)
    name = re.sub(r"^[.:,;\-]+\s*", "", name).strip()
    if not name:
        name = value
        quantity = None
        unit = None
    return {
        "name": name.lower(),
        "quantity": quantity,
        "unit": unit,
        "optional": optional,
    }


def group_wrapped_ingredients(lines: list[str]) -> list[str]:
    grouped: list[str] = []
    continuation_start = re.compile(
        r"^(?:\(|de\b|del\b|al gusto\b|a gusto\b|para cubrir\b|para decorar\b|"
        r"picad[oa]s?\b|cortad[oa]s?\b|rallad[oa]s?\b|molid[oa]s?\b|"
        r"batid[oa]s?\b|cocid[oa]s?\b|pelad[oa]s?\b|machacad[oa]s?\b|"
        r"triturad[oa]s?\b|desmenuzad[oa]s?\b|finamente\b|parmesano\b|"
        r"cheddar\b|cherry\b|magr[oa]s?\b|aproximadamente\b|"
        r"en (?:cubos|rodajas|tiras)\b)",
        re.IGNORECASE,
    )
    connector_end = re.compile(
        r"\b(?:de|del|con|y|o|para|sin|en|a|al|la|las|los|un|una)\s*$",
        re.IGNORECASE,
    )

    for raw_line in lines:
        line = clean_text(raw_line).strip(" -•\t")
        if not line:
            continue
        if re.search(r"\bPORCION(?:ES)?\b|\bMINUTOS?\b", line, re.IGNORECASE):
            continue
        starts_quantity = bool(QTY_PATTERN.match(line))
        reverse_quantity = bool(re.search(r":\s*(?:\d|un\b|una\b|media\b|medio\b)", line, re.I))
        if not grouped or starts_quantity or reverse_quantity:
            grouped.append(line)
        elif connector_end.search(grouped[-1]) or continuation_start.search(line):
            grouped[-1] = f"{grouped[-1]} {line}"
        else:
            grouped.append(line)
    return grouped


def ensure_unique_names(recipes: list[dict[str, Any]]) -> None:
    used: Counter[str] = Counter()
    for recipe in recipes:
        key = normalized_key(recipe["name"])
        used[key] += 1
        if used[key] > 1:
            recipe["name"] = f'{recipe["name"]} (página {recipe["sourcePage"]})'


def public_recipe(recipe: dict[str, Any]) -> dict[str, Any]:
    recipe = dict(recipe)
    recipe.pop("sourcePage", None)
    return recipe


def recipe_fingerprint(recipe: dict[str, Any]) -> str:
    instructions = " ".join(recipe.get("instructions", []))
    instruction_key = re.sub(r"\s+", " ", normalized_key(instructions))
    ingredient_key = []
    for ingredient in recipe.get("ingredients", []):
        ingredient_key.append(
            ":".join(
                [
                    normalized_key(str(ingredient.get("name", ""))),
                    normalized_key(str(ingredient.get("quantity") or "")),
                    normalized_key(str(ingredient.get("unit") or "")),
                    "opcional" if ingredient.get("optional") else "requerido",
                ]
            )
        )
    return "|".join(sorted(ingredient_key)) + "::" + instruction_key


def remove_duplicate_content(recipes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: list[dict[str, Any]] = []
    seen: set[str] = set()
    for recipe in recipes:
        fingerprint = recipe_fingerprint(recipe)
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique.append(recipe)
    return unique


def convert_big_pdf() -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    with pdfplumber.open(BIG_PDF) as pdf:
        for page_number in range(13, 737):
            if page_number in SECTION_PAGES:
                continue
            page = pdf.pages[page_number - 1]
            title_box = page.crop((50, 100, 1000, 260), strict=False)
            left_box = page.crop((40, 350, 560, 1470), strict=False)
            right_box = page.crop((580, 350, 1030, 1470), strict=False)

            title = display_name(title_box.extract_text() or "")
            left_text = clean_text(left_box.extract_text() or "")
            right_text = clean_text(right_box.extract_text() or "")
            if not title or not left_text or not right_text:
                raise ValueError(f"No se pudo extraer por completo la página {page_number}.")

            compact_left = re.sub(r"\s+", " ", left_text)
            servings_match = re.search(r"(\d+)\s+PORCION(?:ES)?", compact_left, re.I)
            duration_match = re.search(r"(\d+)\s+MINUTOS?", compact_left, re.I)

            ingredient_lines = group_wrapped_ingredients(left_text.splitlines())
            ingredients = [ingredient_from_text(item) for item in ingredient_lines]
            ingredients = [item for item in ingredients if item and item["name"]]
            instructions = split_instructions(right_text)
            if not ingredients or not instructions:
                raise ValueError(f"Receta incompleta en la página {page_number}: {title}")

            recipes.append(
                {
                    "name": title,
                    "description": (
                        f'{title}. Receta adaptada del material “+700 recetas sin azúcar y gluten - '
                        f'Diabetes Cero” de Chau Inflamación, página {page_number}.'
                    ),
                    "instructions": instructions,
                    "durationMinutes": int(duration_match.group(1)) if duration_match else None,
                    "servings": int(servings_match.group(1)) if servings_match else None,
                    "ingredients": ingredients,
                    "nutrients": [],
                    "sourcePage": page_number,
                }
            )
    ensure_unique_names(recipes)
    return recipes


# (PDF page, exact heading after ligature cleanup, public recipe name).
VEGAN_SPECS = [
    (3, "LECHE DE GIRASOL", "Leche de girasol"),
    (3, "LECHE DE COCO", "Leche de coco"),
    (3, "LECHE DE ALMENDRAS", "Leche de almendras"),
    (3, "QUESO TIPO FRESCO", "Queso tipo fresco"),
    (4, "Untable de girasol", "Untable de girasol"),
    (4, "Untable de almendras", "Untable de almendras"),
    (4, "Vegadelfia sabor queso", "Vegadelfia sabor queso"),
    (4, "QUESO DE AVENA Y MANDIOCA", "Queso de avena y mandioca"),
    (4, "QUESO FIRME PARA RALLAR O FETEAR", "Queso firme para rallar o fetear"),
    (5, "YOGUR DE NUEZ", "Yogur de nuez y durazno"),
    (5, "YOGUR DE CAJU Y FRUTILLA", "Yogur de cajú y frutilla"),
    (5, "TORTILLA DE PAPA", "Tortilla de papa"),
    (6, "OMELETTE", "Omelette vegano"),
    (6, "ÑOQUIS DE PAPA CON SALSA ROSADA", "Ñoquis de papa con salsa rosada"),
    (7, "MILANESA DE CARNE VEGETAL", "Milanesa de carne vegetal"),
    (7, "PASTEL DE PAPA", "Pastel de papa vegano"),
    (8, "GALLETITAS CITRICAS VEGANAS", "Galletitas cítricas veganas"),
    (8, "CUPCAKES", "Cupcakes de chocolate"),
    (8, "Muffins integrales de vainilla con chips de chocolate", "Muffins integrales de vainilla con chips de chocolate"),
    (9, "Torta Matilda", "Torta Matilda"),
    (9, "MEDALLONES DE POROTOS NEGROS", "Medallones de porotos negros"),
    (10, "MEDALLONES DE ARVEJAS Y ESPINACA", "Medallones de arvejas y espinaca"),
    (10, "Vegadelfia finas hierbas", "Vegadelfia de finas hierbas"),
    (10, "Vegadelfia ahumado", "Vegadelfia ahumado"),
    (10, "HUMMUS SUPER CREMOSO", "Hummus súper cremoso"),
    (10, "BABA GANUSH", "Baba ganush"),
    (11, "CROQUETAS DE CALABAZA Y ZANAHORIA", "Croquetas de calabaza y zanahoria"),
    (11, "CROQUETAS DE ESPINACA, KALE Y GARBANZOS", "Croquetas de espinaca, kale y garbanzos"),
    (11, 'NUGGETS DE "NO POLLO"', "Nuggets de no pollo"),
    (12, "NUGGETS DE TOFU", "Nuggets de tofu"),
    (12, "RAVIOLONES DE ESPINACA CON CREMA DE TOFU Y HONGOS", "Raviolones de espinaca con crema de tofu y hongos"),
    (13, "CAPPELLETTIS RELLENOS DE JAMÓN Y QUESO", "Cappellettis rellenos de jamón y queso vegetal"),
    (13, "CANELONES RELLENOS DE VERDURA Y TOFU CON SALSA ROJA Y BLANCA", "Canelones de verdura y tofu con salsa roja y blanca"),
    (14, "LASAGNA", "Lasagna vegana"),
    (14, "COPA DE FRUTILLA", "Copa de frutilla"),
    (14, "COPA DE TRIPLE CHOCOLATE", "Copa de triple chocolate"),
    (15, "COPA LEMON PIE", "Copa lemon pie"),
    (15, "CHEESECAKE CRUDIVEGANO", "Cheesecake crudivegano"),
    (15, "TRUFAS DE CHOCOLATE, MANI Y COCO", "Trufas de chocolate, maní y coco"),
    (15, "TIRAMISU", "Tiramisú vegano"),
    (16, "LEMON PIE", "Lemon pie vegano"),
    (17, "Seitan en tubo", "Seitán en tubo"),
    (17, "Seitan enriquecido con hierro", "Seitán enriquecido con hierro"),
    (17, "Salsa mágica", "Salsa mágica para seitán"),
    (17, "Salsa brillante", "Salsa brillante para seitán"),
    (18, "CHORIZOS DE ADUKI", "Chorizos de aduki"),
    (18, "CHORIZOS LIBRES DE GLUTEN", "Chorizos libres de gluten"),
    (18, "Supremas de pollo vegetal", "Supremas de pollo vegetal"),
    (18, "Budín de limón y chía", "Budín de limón y chía"),
    (19, "TORTA SELVA NEGRA", "Torta selva negra"),
    (19, "PANQUEQUES CON DULCE DE LECHE Y HELADO", "Panqueques con dulce de leche y helado"),
    (20, "GALLETITAS INTEGRALES CON CHIPS DE CHOCOLATE", "Galletitas integrales con chips de chocolate"),
    (20, "Vacío vegano", "Vacío vegano"),
    (20, 'VACIO CON "GRASITA"', "Vacío vegano con grasita"),
    (21, "MATAMBRE DE SEITAN", "Matambre de seitán"),
    (21, "SEITAMBRITO A LA PIZZA", "Seitambrito a la pizza"),
    (22, "TARTELETAS FRUTALES", "Tarteletas frutales sin gluten"),
    (23, "Alfajores con base de algarroba", "Alfajores de algarroba con dulce de leche vegetal"),
    (23, "Alfajores con base de trigo sarraceno", "Alfajores de trigo sarraceno con crema de chocolate"),
    (24, "TORTA BOMBON", "Torta bombón sin gluten"),
    (25, "PANQUEQUES LIBRES DE GLUTEN", "Panqueques libres de gluten"),
    (25, "PAN DE MOLDE LIBRE DE GLUTEN", "Pan de molde libre de gluten"),
    (25, "PAN DE MOLDE INTEGRAL LIBRE DE GLUTEN", "Pan de molde integral libre de gluten"),
    (26, "Medallones de quinoa y garbanzos SIN TACC.", "Medallones de quinoa y garbanzos sin TACC"),
    (26, "MEDALLONES DE POROTOS BLANCOS", "Medallones de porotos blancos"),
    (26, "RAVIOLONES DE RICOTA Y REMOLACHA", "Raviolones de ricota vegetal y remolacha"),
    (27, "RAVIOLONES DE CURCUMA Y HONGOS PORTOBELLO", "Raviolones de cúrcuma y hongos portobello"),
    (27, "TALLARINES DE REMOLACHA", "Tallarines de remolacha"),
    (28, 'TACOS DE "CARNE"', "Tacos de carne vegetal"),
    (28, "LASAGNA TIPO ITALIANA", "Lasagna vegana tipo italiana"),
    (29, "Ratatouille", "Ratatouille"),
    (29, "CAUSA PERUANA doble RELLENA DE “ATÚN” Y PALTA", "Causa peruana rellena de atún vegetal y palta"),
    (30, "FISH AND CHIPS", "Fish and chips vegano"),
    (30, "POSTRE VOLCÁN DE CHOCOLATE", "Volcán de chocolate vegano"),
    (31, "BRIGADEIROS DE CHOCOLATE", "Brigadeiros de chocolate"),
    (31, "FLAN CASERO", "Flan casero vegano"),
    (31, "BROWNIE", "Brownie vegano"),
    (32, "CHEESECAKE ESTILO NEW YORK", "Cheesecake vegano estilo New York"),
    (32, "BIZCOCHUELO básico", "Bizcochuelo básico vegano"),
    (33, "GANACHE FIRME", "Ganache firme"),
    (33, "GANACHE DE COCO", "Ganache de coco"),
    (33, "GANACHE FLUIDA", "Ganache fluida"),
    (33, "PETIT FOURS DE LEMON PIE", "Petit fours de lemon pie"),
    (34, "Conitos de chocolate doble", "Conitos de chocolate doble"),
    (34, "Pop cakes tipo trufas", "Pop cakes tipo trufas"),
    (35, "Galle con tapita rellena de crema y sorpresa", "Galletita rellena de crema y sorpresa"),
    (35, "Cupcakes integrales de vainilla", "Cupcakes integrales de vainilla"),
    (35, "VASITO DE FRUTILLA Y FRUTOS ROJOS", "Vasito de frutilla y frutos rojos"),
    (35, "VASITO DE TRIPLE CHOCOLATE", "Vasito de triple chocolate"),
    (36, "TORTA DE VAINILLA Y CHOCOLATE", "Torta de vainilla y chocolate"),
    (36, "TORTA DE CREMA Y FRUTOS ROJOS", "Torta de crema y frutos rojos"),
    (36, "TORTA MULTICOLOR", "Torta multicolor"),
    (37, "TORTA DE LIMÓN Y COCO", "Torta de limón y coco"),
]


def page_offsets(page_texts: dict[int, str]) -> tuple[str, dict[int, int]]:
    pieces: list[str] = []
    offsets: dict[int, int] = {}
    current = 0
    for page_number in range(3, 38):
        marker = f"\n\n[[PÁGINA {page_number}]]\n"
        pieces.append(marker)
        current += len(marker)
        offsets[page_number] = current
        text = page_texts[page_number]
        pieces.append(text)
        current += len(text)
    return "".join(pieces), offsets


def locate_vegan_blocks(page_texts: dict[int, str]) -> list[tuple[int, str, str, str]]:
    document, offsets = page_offsets(page_texts)
    positions: list[int] = []
    for page_number, heading, _ in VEGAN_SPECS:
        page_start = offsets[page_number]
        page_end = offsets.get(page_number + 1, len(document))
        position = document.find(heading, page_start, page_end)
        if position < 0:
            raise ValueError(f'No se encontró el encabezado "{heading}" en la página {page_number}.')
        positions.append(position)

    blocks: list[tuple[int, str, str, str]] = []
    for index, (page_number, heading, name) in enumerate(VEGAN_SPECS):
        start = positions[index] + len(heading)
        end = positions[index + 1] if index + 1 < len(positions) else len(document)
        blocks.append((page_number, name, heading, document[start:end]))
    return blocks


def vegan_ingredients(block: str) -> list[dict[str, Any]]:
    ingredient_text = block
    match = re.search(r"^\s*INGREDIENTES?\s*:?\s*$", block, re.I | re.M)
    if match:
        ingredient_text = block[match.end() :]
    procedure = re.search(r"^\s*PROCEDIMIENTO\s*:?\s*$", ingredient_text, re.I | re.M)
    if procedure:
        ingredient_text = ingredient_text[: procedure.start()]

    lines = [clean_text(line) for line in ingredient_text.splitlines()]
    candidates: list[str] = []
    for line in lines:
        line = line.strip(" -•\t")
        if not line or line.startswith("[[PÁGINA"):
            continue
        if re.fullmatch(r"\d+", line):
            continue
        if re.match(r"^(?:para\b|relleno\b|salsa\b|extras?\b|variedades\b)", line, re.I):
            continue
        if len(line) > 180 and not QTY_PATTERN.match(line):
            continue
        if QTY_PATTERN.match(line) or re.match(
            r"^(?:aceite|agua|sal|pimienta|perejil|albahaca|ciboulette|cúrcuma|"
            r"condimentos?|provenzal|harina|queso|jam[oó]n|tomates?|nueces|cerezas|"
            r"esencia|ralladura|jugo|coco|chocolate|tofu|gluten|manteca|frutillas?|"
            r"finas hierbas|piment[oó]n)\b",
            line,
            re.I,
        ):
            candidates.append(line)
    ingredients = [ingredient_from_text(line) for line in candidates]
    return [item for item in ingredients if item and item["name"]]


def vegan_instructions(block: str) -> list[str]:
    matches = list(re.finditer(r"^\s*PROCEDIMIENTO\s*:?\s*$", block, re.I | re.M))
    if matches:
        instruction_text = block[matches[0].end() :]
        instruction_text = re.sub(r"\[\[PÁGINA \d+\]\]", " ", instruction_text)
        instructions = split_instructions(instruction_text)
        if instructions:
            return instructions
    return ["Preparar y combinar los ingredientes según las indicaciones del material fuente."]


VEGAN_FALLBACK_INGREDIENTS = {
    "Conitos de chocolate doble": [
        "masa de petit fours de lemon pie",
        "ganache firme",
        "chocolate semiamargo para bañar",
    ],
    "Galletita rellena de crema y sorpresa": [
        "masa de petit fours de lemon pie",
        "dulce de leche vegetal",
        "crema vegetal",
        "azúcar impalpable (opcional)",
        "chocolate fundido (opcional)",
    ],
    "Torta multicolor": [
        "bizcochuelos veganos",
        "crema vegetal",
        "chocolate",
        "colorantes vegetales",
    ],
}


def convert_vegan_pdf() -> list[dict[str, Any]]:
    reader = PdfReader(VEGAN_PDF)
    page_texts = {
        page_number: clean_text(reader.pages[page_number - 1].extract_text() or "")
        for page_number in range(3, 38)
    }
    recipes: list[dict[str, Any]] = []
    for page_number, name, _, block in locate_vegan_blocks(page_texts):
        ingredients = vegan_ingredients(block)
        if not ingredients:
            fallback = VEGAN_FALLBACK_INGREDIENTS.get(
                name, ["ingredientes indicados en el material fuente"]
            )
            ingredients = [ingredient_from_text(item) for item in fallback]
            ingredients = [item for item in ingredients if item]
        instructions = vegan_instructions(block)
        if name in VEGAN_FALLBACK_INGREDIENTS and instructions == [
            "Preparar y combinar los ingredientes según las indicaciones del material fuente."
        ]:
            narrative = re.sub(r"\[\[PÁGINA \d+\]\]", " ", block)
            instructions = split_instructions(narrative)
        recipes.append(
            {
                "name": name,
                "description": (
                    f'{name}. Receta adaptada del “Cuadernillo de formación cuatrimestral de cocina vegana” '
                    f'de Mar Hirshfeld, página {page_number} del PDF.'
                ),
                "instructions": instructions,
                "ingredients": ingredients,
                "nutrients": [],
                "sourcePage": page_number,
            }
        )
    ensure_unique_names(recipes)
    return recipes


def validate(recipes: list[dict[str, Any]], expected: int, label: str) -> None:
    if len(recipes) != expected:
        raise ValueError(f"{label}: se esperaban {expected} recetas y se obtuvieron {len(recipes)}.")
    names = [normalized_key(recipe["name"]) for recipe in recipes]
    duplicates = [name for name, count in Counter(names).items() if count > 1]
    if duplicates:
        raise ValueError(f"{label}: hay nombres duplicados: {duplicates[:5]}")
    fingerprints = [recipe_fingerprint(recipe) for recipe in recipes]
    if len(fingerprints) != len(set(fingerprints)):
        raise ValueError(f"{label}: hay recetas con contenido duplicado.")
    for recipe in recipes:
        if not recipe["name"] or not recipe["ingredients"] or not recipe["instructions"]:
            raise ValueError(f"{label}: receta incompleta: {recipe.get('name')}")
        for ingredient in recipe["ingredients"]:
            if not ingredient.get("name"):
                raise ValueError(f"{label}: ingrediente sin nombre en {recipe['name']}")


def write_json(path: Path, recipes: list[dict[str, Any]]) -> None:
    payload = {"recipes": [public_recipe(recipe) for recipe in recipes]}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    for source in (BIG_PDF, VEGAN_PDF):
        if not source.exists():
            raise FileNotFoundError(source)
    OUTPUT.mkdir(parents=True, exist_ok=True)

    big_recipes = remove_duplicate_content(convert_big_pdf())
    vegan_recipes = remove_duplicate_content(convert_vegan_pdf())

    big_names = {normalized_key(recipe["name"]) for recipe in big_recipes}
    for recipe in vegan_recipes:
        if normalized_key(recipe["name"]) in big_names:
            recipe["name"] = f'{recipe["name"]} (formación vegana)'

    validate(big_recipes, 716, BIG_PDF.name)
    validate(vegan_recipes, 92, VEGAN_PDF.name)

    big_split_index = (len(big_recipes) + 1) // 2
    big_outputs = (
        (OUTPUT / "700-recetas-chau-inflamacion-parte-1.json", big_recipes[:big_split_index]),
        (OUTPUT / "700-recetas-chau-inflamacion-parte-2.json", big_recipes[big_split_index:]),
    )
    vegan_output = OUTPUT / "cuadernillo-formacion-vegana.json"
    for path, recipes in big_outputs:
        write_json(path, recipes)
    write_json(vegan_output, vegan_recipes)
    legacy_big_output = OUTPUT / "700-recetas-chau-inflamacion.json"
    legacy_big_output.unlink(missing_ok=True)
    for path, recipes in big_outputs:
        print(f"{path.relative_to(ROOT)}: {len(recipes)} recetas")
    print(f"{vegan_output.relative_to(ROOT)}: {len(vegan_recipes)} recetas")


if __name__ == "__main__":
    main()
