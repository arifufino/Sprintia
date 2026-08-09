# Sprintia

Sprintia es un tracker Scrum colaborativo y sencillo para proyectos universitarios.

## Funciones principales

- Inicio de sesión seguro con ChatGPT.
- Espacios de trabajo compartidos mediante enlace o código de invitación.
- Tablero Kanban con arrastrar y soltar, además de controles accesibles para mover tareas.
- Backlog, sprints, prioridades, responsables y puntos de historia.
- Resumen de progreso, distribución del trabajo y actividad del equipo.
- Diseño responsive para computadora, tableta y móvil.
- Persistencia compartida con Cloudflare D1, sin depender de Supabase ni MongoDB.

## Desarrollo local

```bash
npm install
npm run dev
```

En desarrollo se utiliza una identidad local de demostración. En la versión publicada, Sprintia usa el inicio de sesión administrado por Sites.

## Comprobaciones

```bash
npm run lint
npm run build
npm test
```
