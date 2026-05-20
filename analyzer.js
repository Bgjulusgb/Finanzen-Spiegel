openapi: 3.0.3
info:
  title: Pressespiegel API
  version: 2.0.0
  description: REST + WebSocket API fuer den Pressespiegel der Muenchner Kammerspiele.
servers:
  - url: http://localhost:4711/api
    description: Lokaler Entwicklungs-Server

paths:
  /health:
    get:
      summary: Health Check
      responses:
        '200':
          description: Service laeuft

  /articles:
    get:
      summary: Artikel suchen
      parameters:
        - in: query
          name: q
          schema: { type: string }
        - in: query
          name: from
          schema: { type: string, format: date }
        - in: query
          name: to
          schema: { type: string, format: date }
        - in: query
          name: last
          schema: { type: string, example: 30d }
        - in: query
          name: category
          schema: { type: string, description: 'kommasepariert: sehr_relevant,relevant,...' }
        - in: query
          name: sentiment
          schema: { type: string }
        - in: query
          name: source
          schema: { type: string }
        - in: query
          name: tag
          schema: { type: string, description: 'kommasepariert (AND-Verknuepfung)' }
        - in: query
          name: type
          schema: { type: string }
        - in: query
          name: bookmark
          schema: { type: string, enum: [yes, no] }
        - in: query
          name: minScore
          schema: { type: integer }
        - in: query
          name: maxScore
          schema: { type: integer }
        - in: query
          name: limit
          schema: { type: integer, default: 500 }
      responses:
        '200':
          description: Trefferliste
          content:
            application/json:
              schema:
                type: object
                properties:
                  from: { type: string, format: date-time }
                  to: { type: string, format: date-time }
                  total: { type: integer }
                  returned: { type: integer }
                  articles:
                    type: array
                    items: { $ref: '#/components/schemas/Article' }

  /article/{id}:
    get:
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      responses:
        '200':
          description: Einzelner Artikel

  /article/{id}/tags:
    get:
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      responses:
        '200': { description: Tag-Liste }
    post:
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [tag]
              properties:
                tag: { type: string }
      responses:
        '200': { description: OK }

  /article/{id}/bookmark:
    post:
      parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
      responses: { '200': { description: OK } }
    delete:
      parameters: [{ in: path, name: id, required: true, schema: { type: integer } }]
      responses: { '200': { description: OK } }

  /saved-searches:
    get: { responses: { '200': { description: Liste } } }
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name]
              properties:
                name: { type: string }
                query: { type: string }
                filters: { type: object }
      responses: { '200': { description: OK } }

  /scan:
    post:
      summary: Scan starten
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                from: { type: string, format: date }
                to: { type: string, format: date }
                last: { type: string, example: 7d }
      responses:
        '200': { description: Scan-ID }
        '409': { description: Bereits ein Scan aktiv }

  /report:
    post:
      summary: HTML/PDF-Report erzeugen
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                format: { type: string, enum: [html, pdf, both] }
                title: { type: string }
                from: { type: string, format: date }
                to: { type: string, format: date }
                last: { type: string }
      responses:
        '200': { description: Report erstellt }

components:
  schemas:
    Article:
      type: object
      properties:
        id: { type: integer }
        url: { type: string }
        title: { type: string }
        source: { type: string }
        author: { type: string, nullable: true }
        published_date: { type: string, format: date-time, nullable: true }
        summary: { type: string }
        full_text: { type: string }
        relevance_score: { type: integer }
        sentiment: { type: string, enum: [positiv, neutral, negativ] }
        category: { type: string }
        article_type: { type: string }
        paywall: { type: boolean }
        tags: { type: array, items: { type: string } }
        bookmarked: { type: boolean }
