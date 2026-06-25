# Contribuir

Las contribuciones son bienvenidas. Si encontraste un bug, tienes una idea para un nuevo agente o quieres mejorar algo, el proceso es simple.

---

## Antes de enviar un PR

Abre un issue primero para discutir lo que quieres cambiar. Esto evita trabajo perdido en ambos lados, especialmente para cambios mayores.

---

## Setup local

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
```

---

## Estructura del proyecto

```
Reversa-Matrix/
├── agents/             ← cada agente tiene su carpeta con SKILL.md
├── bin/                ← punto de entrada del CLI (reversa.js)
├── lib/
│   ├── commands/       ← implementación de los comandos CLI
│   └── installer/      ← lógica de instalación y detección de motores
├── templates/          ← plantillas de config y archivos de entrada por motor
└── docs/               ← documentación (estás aquí)
```

---

## Agregar un nuevo agente

1. Crea la carpeta `agents/reversa-[nombre]/`
2. Crea `SKILL.md` siguiendo el formato de los agentes existentes (frontmatter obligatorio: `name`, `description`, `license`, `compatibility`, `metadata`)
3. Agrega la carpeta `references/` si el agente necesita schemas o plantillas de referencia
4. Actualiza `lib/installer/` para incluir el nuevo agente en la lista de instalación

---

## Licencia

MIT. Ver [LICENSE](https://github.com/Fractal-Echo/Reversa-Matrix/blob/main/LICENSE) para los detalles.
