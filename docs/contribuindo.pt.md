# Contribuindo

Contribuições são bem-vindas. Se você encontrou um bug, tem uma ideia para um novo agente, ou quer melhorar alguma coisa, o processo é simples.

---

## Antes de enviar um PR

Abra uma issue primeiro para discutir o que você quer mudar. Isso evita trabalho perdido nos dois lados, especialmente para mudanças maiores.

---

## Setup local

```bash
git clone https://github.com/Fractal-Echo/Reversa-Matrix.git
cd Reversa-Matrix
npm install
```

---

## Estrutura do projeto

```
Reversa-Matrix/
├── agents/             ← cada agente tem sua pasta com SKILL.md
├── bin/                ← ponto de entrada do CLI (reversa.js)
├── lib/
│   ├── commands/       ← implementação dos comandos CLI
│   └── installer/      ← lógica de instalação e detecção de engines
├── templates/          ← templates de config e arquivos de entrada por engine
└── docs/               ← documentação (você está aqui)
```

---

## Adicionando um novo agente

1. Crie a pasta `agents/reversa-[nome]/`
2. Crie o `SKILL.md` seguindo o formato dos agentes existentes (frontmatter obrigatório: `name`, `description`, `license`, `compatibility`, `metadata`)
3. Adicione a pasta `references/` se o agente precisar de schemas ou templates de referência
4. Atualize `lib/installer/` para incluir o novo agente na lista de instalação

---

## Licença

MIT. Veja [LICENSE](https://github.com/Fractal-Echo/Reversa-Matrix/blob/main/LICENSE) para os detalhes.
