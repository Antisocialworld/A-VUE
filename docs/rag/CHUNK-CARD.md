# Chunk card

How the corpus in `rag-chunks.md` is split into retrievable chunks, and how to ingest it. All content is fictional.

## Rules

1. **One chunk = one self-contained fact set about one entity.** Every chunk repeats the entity's name at its start, so it makes sense with no neighbours.
2. **No overlap and no further splitting.** The largest chunk is 104 words. Do not cut chunks by token count.
3. **Chunk id = `<source id>#<part>`.** Everything before the `#` is the source document id. FAQ chunks and policy chunks use their own id as the source.
4. **What to embed:** the text under the header line. Store the header fields (`type`, `source`, `slug`) as metadata.
5. **Retrieval and citation:** a RAG answer should return the chunk ids it used. The eval scorer strips everything after `#`, so `mv-001#plot` counts as document `mv-001`.
6. **Suggested top-k:** 4 to 6. Questions about a whole director's films or a whole cinema's week need several chunks.
7. **Facts that live in two places must agree.** Cinema accessibility and bar facts are in both a cinema chunk and a policy chunk, and FAQ answers repeat them. Treat a disagreement as a data bug.

## Parsing

Each card in `rag-chunks.md` is: a line `## CHUNK <id>`, a header line `type: <t> | source: <s> | slug: <slug> | words: <n>`, then the text until the next `## CHUNK`. `words` is the number of whitespace-separated words in the text.

## Chunk types

| Type | Chunk id pattern | Count | Words (min / avg / max) | What it holds |
|---|---|---|---|---|
| movie_summary | `<mv-id>#summary` | 24 | 65 / 75 / 86 | Title, year, genres, director, language, country, runtime, rating, logline, cast, themes, reception, awards, keywords. One per movie. |
| movie_plot | `<mv-id>#plot` | 24 | 63 / 70 / 78 | The plot paragraph with the title and director repeated at the start. One per movie. |
| cinema_about | `<cin-id>#about` | 3 | 49 / 55 / 61 | Address, phone, screens, wheelchair access, parking, bar, ticket prices. |
| cinema_hours | `<cin-id>#hours` | 3 | 40 / 42 / 45 | Opening hours for all seven days, including closed days and after-midnight closing. |
| cinema_now_showing | `<cin-id>#now-showing` | 3 | 39 / 45 / 49 | Titles that have showtimes this week at that cinema. |
| cinema_showtimes_day | `<cin-id>#show-<day>` | 19 | 27 / 38 / 47 | Every showtime for one cinema on one day, with screen and ticket price. No chunk for closed days. |
| policy | `<pol-id>` | 6 | 43 / 69 / 99 | One policy document per chunk (refunds, seat holds, age ratings, accessibility, late entry, food and drink). |
| faq_movie | `faq-NNN` | 120 | 10 / 25 / 41 | One question and answer about one movie. |
| faq_cinema | `faq-NNN` | 15 | 15 / 24 / 43 | One question and answer about one cinema. |
| faq_policy | `faq-NNN` | 14 | 16 / 29 / 53 | One question and answer about a booking policy. |
| person | `person-<name-slug>` | 20 | 13 / 45 / 104 | A director or actor and the films they are in. |

**Total: 251 chunks, 9668 words.**

## Index of every chunk

| Chunk id | Type | Source | Words |
|---|---|---|---|
| mv-001#summary | movie_summary | mv-001 | 84 |
| mv-001#plot | movie_plot | mv-001 | 71 |
| mv-002#summary | movie_summary | mv-002 | 76 |
| mv-002#plot | movie_plot | mv-002 | 75 |
| mv-003#summary | movie_summary | mv-003 | 83 |
| mv-003#plot | movie_plot | mv-003 | 73 |
| mv-004#summary | movie_summary | mv-004 | 76 |
| mv-004#plot | movie_plot | mv-004 | 67 |
| mv-005#summary | movie_summary | mv-005 | 83 |
| mv-005#plot | movie_plot | mv-005 | 64 |
| mv-006#summary | movie_summary | mv-006 | 72 |
| mv-006#plot | movie_plot | mv-006 | 69 |
| mv-007#summary | movie_summary | mv-007 | 75 |
| mv-007#plot | movie_plot | mv-007 | 72 |
| mv-008#summary | movie_summary | mv-008 | 65 |
| mv-008#plot | movie_plot | mv-008 | 69 |
| mv-009#summary | movie_summary | mv-009 | 82 |
| mv-009#plot | movie_plot | mv-009 | 73 |
| mv-010#summary | movie_summary | mv-010 | 71 |
| mv-010#plot | movie_plot | mv-010 | 70 |
| mv-011#summary | movie_summary | mv-011 | 82 |
| mv-011#plot | movie_plot | mv-011 | 69 |
| mv-012#summary | movie_summary | mv-012 | 75 |
| mv-012#plot | movie_plot | mv-012 | 68 |
| mv-013#summary | movie_summary | mv-013 | 73 |
| mv-013#plot | movie_plot | mv-013 | 71 |
| mv-014#summary | movie_summary | mv-014 | 86 |
| mv-014#plot | movie_plot | mv-014 | 70 |
| mv-015#summary | movie_summary | mv-015 | 70 |
| mv-015#plot | movie_plot | mv-015 | 65 |
| mv-016#summary | movie_summary | mv-016 | 80 |
| mv-016#plot | movie_plot | mv-016 | 71 |
| mv-017#summary | movie_summary | mv-017 | 73 |
| mv-017#plot | movie_plot | mv-017 | 63 |
| mv-018#summary | movie_summary | mv-018 | 78 |
| mv-018#plot | movie_plot | mv-018 | 78 |
| mv-019#summary | movie_summary | mv-019 | 70 |
| mv-019#plot | movie_plot | mv-019 | 66 |
| mv-020#summary | movie_summary | mv-020 | 67 |
| mv-020#plot | movie_plot | mv-020 | 69 |
| mv-021#summary | movie_summary | mv-021 | 75 |
| mv-021#plot | movie_plot | mv-021 | 70 |
| mv-022#summary | movie_summary | mv-022 | 70 |
| mv-022#plot | movie_plot | mv-022 | 72 |
| mv-023#summary | movie_summary | mv-023 | 67 |
| mv-023#plot | movie_plot | mv-023 | 71 |
| mv-024#summary | movie_summary | mv-024 | 76 |
| mv-024#plot | movie_plot | mv-024 | 69 |
| cin-002#about | cinema_about | cin-002 | 49 |
| cin-002#hours | cinema_hours | cin-002 | 40 |
| cin-002#now-showing | cinema_now_showing | cin-002 | 49 |
| cin-002#show-mon | cinema_showtimes_day | cin-002 | 36 |
| cin-002#show-tue | cinema_showtimes_day | cin-002 | 32 |
| cin-002#show-wed | cinema_showtimes_day | cin-002 | 36 |
| cin-002#show-thu | cinema_showtimes_day | cin-002 | 37 |
| cin-002#show-fri | cinema_showtimes_day | cin-002 | 37 |
| cin-002#show-sat | cinema_showtimes_day | cin-002 | 38 |
| cin-002#show-sun | cinema_showtimes_day | cin-002 | 37 |
| cin-001#about | cinema_about | cin-001 | 54 |
| cin-001#hours | cinema_hours | cin-001 | 45 |
| cin-001#now-showing | cinema_now_showing | cin-001 | 46 |
| cin-001#show-mon | cinema_showtimes_day | cin-001 | 43 |
| cin-001#show-tue | cinema_showtimes_day | cin-001 | 45 |
| cin-001#show-wed | cinema_showtimes_day | cin-001 | 45 |
| cin-001#show-thu | cinema_showtimes_day | cin-001 | 43 |
| cin-001#show-fri | cinema_showtimes_day | cin-001 | 47 |
| cin-001#show-sat | cinema_showtimes_day | cin-001 | 47 |
| cin-001#show-sun | cinema_showtimes_day | cin-001 | 43 |
| cin-003#about | cinema_about | cin-003 | 61 |
| cin-003#hours | cinema_hours | cin-003 | 41 |
| cin-003#now-showing | cinema_now_showing | cin-003 | 39 |
| cin-003#show-wed | cinema_showtimes_day | cin-003 | 31 |
| cin-003#show-thu | cinema_showtimes_day | cin-003 | 30 |
| cin-003#show-fri | cinema_showtimes_day | cin-003 | 36 |
| cin-003#show-sat | cinema_showtimes_day | cin-003 | 38 |
| cin-003#show-sun | cinema_showtimes_day | cin-003 | 27 |
| pol-004 | policy | pol-004 | 57 |
| pol-003 | policy | pol-003 | 78 |
| pol-006 | policy | pol-006 | 43 |
| pol-005 | policy | pol-005 | 64 |
| pol-002 | policy | pol-002 | 73 |
| pol-001 | policy | pol-001 | 99 |
| faq-001 | faq_movie | faq-001 | 28 |
| faq-002 | faq_movie | faq-002 | 12 |
| faq-003 | faq_movie | faq-003 | 26 |
| faq-004 | faq_movie | faq-004 | 22 |
| faq-005 | faq_movie | faq-005 | 18 |
| faq-006 | faq_movie | faq-006 | 30 |
| faq-007 | faq_movie | faq-007 | 12 |
| faq-008 | faq_movie | faq-008 | 30 |
| faq-009 | faq_movie | faq-009 | 22 |
| faq-010 | faq_movie | faq-010 | 20 |
| faq-011 | faq_movie | faq-011 | 31 |
| faq-012 | faq_movie | faq-012 | 14 |
| faq-013 | faq_movie | faq-013 | 29 |
| faq-014 | faq_movie | faq-014 | 24 |
| faq-015 | faq_movie | faq-015 | 20 |
| faq-016 | faq_movie | faq-016 | 36 |
| faq-017 | faq_movie | faq-017 | 16 |
| faq-018 | faq_movie | faq-018 | 30 |
| faq-019 | faq_movie | faq-019 | 26 |
| faq-020 | faq_movie | faq-020 | 21 |
| faq-021 | faq_movie | faq-021 | 36 |
| faq-022 | faq_movie | faq-022 | 16 |
| faq-023 | faq_movie | faq-023 | 30 |
| faq-024 | faq_movie | faq-024 | 26 |
| faq-025 | faq_movie | faq-025 | 25 |
| faq-026 | faq_movie | faq-026 | 33 |
| faq-027 | faq_movie | faq-027 | 12 |
| faq-028 | faq_movie | faq-028 | 26 |
| faq-029 | faq_movie | faq-029 | 22 |
| faq-030 | faq_movie | faq-030 | 20 |
| faq-031 | faq_movie | faq-031 | 38 |
| faq-032 | faq_movie | faq-032 | 20 |
| faq-033 | faq_movie | faq-033 | 35 |
| faq-034 | faq_movie | faq-034 | 30 |
| faq-035 | faq_movie | faq-035 | 26 |
| faq-036 | faq_movie | faq-036 | 28 |
| faq-037 | faq_movie | faq-037 | 12 |
| faq-038 | faq_movie | faq-038 | 30 |
| faq-039 | faq_movie | faq-039 | 22 |
| faq-040 | faq_movie | faq-040 | 17 |
| faq-041 | faq_movie | faq-041 | 35 |
| faq-042 | faq_movie | faq-042 | 14 |
| faq-043 | faq_movie | faq-043 | 22 |
| faq-044 | faq_movie | faq-044 | 24 |
| faq-045 | faq_movie | faq-045 | 20 |
| faq-046 | faq_movie | faq-046 | 30 |
| faq-047 | faq_movie | faq-047 | 12 |
| faq-048 | faq_movie | faq-048 | 26 |
| faq-049 | faq_movie | faq-049 | 22 |
| faq-050 | faq_movie | faq-050 | 20 |
| faq-051 | faq_movie | faq-051 | 33 |
| faq-052 | faq_movie | faq-052 | 16 |
| faq-053 | faq_movie | faq-053 | 34 |
| faq-054 | faq_movie | faq-054 | 26 |
| faq-055 | faq_movie | faq-055 | 25 |
| faq-056 | faq_movie | faq-056 | 39 |
| faq-057 | faq_movie | faq-057 | 18 |
| faq-058 | faq_movie | faq-058 | 36 |
| faq-059 | faq_movie | faq-059 | 28 |
| faq-060 | faq_movie | faq-060 | 26 |
| faq-061 | faq_movie | faq-061 | 30 |
| faq-062 | faq_movie | faq-062 | 10 |
| faq-063 | faq_movie | faq-063 | 24 |
| faq-064 | faq_movie | faq-064 | 20 |
| faq-065 | faq_movie | faq-065 | 19 |
| faq-066 | faq_movie | faq-066 | 38 |
| faq-067 | faq_movie | faq-067 | 18 |
| faq-068 | faq_movie | faq-068 | 32 |
| faq-069 | faq_movie | faq-069 | 28 |
| faq-070 | faq_movie | faq-070 | 26 |
| faq-071 | faq_movie | faq-071 | 32 |
| faq-072 | faq_movie | faq-072 | 14 |
| faq-073 | faq_movie | faq-073 | 29 |
| faq-074 | faq_movie | faq-074 | 24 |
| faq-075 | faq_movie | faq-075 | 20 |
| faq-076 | faq_movie | faq-076 | 41 |
| faq-077 | faq_movie | faq-077 | 18 |
| faq-078 | faq_movie | faq-078 | 32 |
| faq-079 | faq_movie | faq-079 | 28 |
| faq-080 | faq_movie | faq-080 | 26 |
| faq-081 | faq_movie | faq-081 | 35 |
| faq-082 | faq_movie | faq-082 | 14 |
| faq-083 | faq_movie | faq-083 | 29 |
| faq-084 | faq_movie | faq-084 | 24 |
| faq-085 | faq_movie | faq-085 | 20 |
| faq-086 | faq_movie | faq-086 | 32 |
| faq-087 | faq_movie | faq-087 | 16 |
| faq-088 | faq_movie | faq-088 | 34 |
| faq-089 | faq_movie | faq-089 | 26 |
| faq-090 | faq_movie | faq-090 | 21 |
| faq-091 | faq_movie | faq-091 | 31 |
| faq-092 | faq_movie | faq-092 | 12 |
| faq-093 | faq_movie | faq-093 | 26 |
| faq-094 | faq_movie | faq-094 | 22 |
| faq-095 | faq_movie | faq-095 | 18 |
| faq-096 | faq_movie | faq-096 | 29 |
| faq-097 | faq_movie | faq-097 | 14 |
| faq-098 | faq_movie | faq-098 | 32 |
| faq-099 | faq_movie | faq-099 | 24 |
| faq-100 | faq_movie | faq-100 | 19 |
| faq-101 | faq_movie | faq-101 | 38 |
| faq-102 | faq_movie | faq-102 | 16 |
| faq-103 | faq_movie | faq-103 | 30 |
| faq-104 | faq_movie | faq-104 | 26 |
| faq-105 | faq_movie | faq-105 | 22 |
| faq-106 | faq_movie | faq-106 | 31 |
| faq-107 | faq_movie | faq-107 | 14 |
| faq-108 | faq_movie | faq-108 | 29 |
| faq-109 | faq_movie | faq-109 | 24 |
| faq-110 | faq_movie | faq-110 | 19 |
| faq-111 | faq_movie | faq-111 | 29 |
| faq-112 | faq_movie | faq-112 | 12 |
| faq-113 | faq_movie | faq-113 | 26 |
| faq-114 | faq_movie | faq-114 | 22 |
| faq-115 | faq_movie | faq-115 | 18 |
| faq-116 | faq_movie | faq-116 | 38 |
| faq-117 | faq_movie | faq-117 | 16 |
| faq-118 | faq_movie | faq-118 | 30 |
| faq-119 | faq_movie | faq-119 | 26 |
| faq-120 | faq_movie | faq-120 | 21 |
| faq-121 | faq_cinema | faq-121 | 15 |
| faq-122 | faq_cinema | faq-122 | 15 |
| faq-123 | faq_cinema | faq-123 | 18 |
| faq-124 | faq_cinema | faq-124 | 26 |
| faq-125 | faq_cinema | faq-125 | 38 |
| faq-126 | faq_cinema | faq-126 | 18 |
| faq-127 | faq_cinema | faq-127 | 15 |
| faq-128 | faq_cinema | faq-128 | 20 |
| faq-129 | faq_cinema | faq-129 | 24 |
| faq-130 | faq_cinema | faq-130 | 43 |
| faq-131 | faq_cinema | faq-131 | 20 |
| faq-132 | faq_cinema | faq-132 | 17 |
| faq-133 | faq_cinema | faq-133 | 25 |
| faq-134 | faq_cinema | faq-134 | 28 |
| faq-135 | faq_cinema | faq-135 | 39 |
| faq-136 | faq_policy | faq-136 | 53 |
| faq-137 | faq_policy | faq-137 | 40 |
| faq-138 | faq_policy | faq-138 | 19 |
| faq-139 | faq_policy | faq-139 | 23 |
| faq-140 | faq_policy | faq-140 | 20 |
| faq-141 | faq_policy | faq-141 | 32 |
| faq-142 | faq_policy | faq-142 | 22 |
| faq-143 | faq_policy | faq-143 | 31 |
| faq-144 | faq_policy | faq-144 | 27 |
| faq-145 | faq_policy | faq-145 | 41 |
| faq-146 | faq_policy | faq-146 | 34 |
| faq-147 | faq_policy | faq-147 | 29 |
| faq-148 | faq_policy | faq-148 | 23 |
| faq-149 | faq_policy | faq-149 | 16 |
| person-amara-eze-banks | person | person-amara-eze-banks | 75 |
| person-caleb-whitlock | person | person-caleb-whitlock | 104 |
| person-cheikh-diallo | person | person-cheikh-diallo | 15 |
| person-dmitri-vance | person | person-dmitri-vance | 83 |
| person-hanna-reiter | person | person-hanna-reiter | 53 |
| person-hye-jin-baek | person | person-hye-jin-baek | 19 |
| person-ines-marlowe | person | person-ines-marlowe | 27 |
| person-kenji-arakawa | person | person-kenji-arakawa | 22 |
| person-lena-hartmann | person | person-lena-hartmann | 13 |
| person-luca-ferrante | person | person-luca-ferrante | 67 |
| person-maeve-gallagher | person | person-maeve-gallagher | 78 |
| person-mireille-duquesne | person | person-mireille-duquesne | 20 |
| person-nadezhda-pell | person | person-nadezhda-pell | 40 |
| person-nadia-volkova | person | person-nadia-volkova | 18 |
| person-oswin-hartley | person | person-oswin-hartley | 16 |
| person-pete-santangelo | person | person-pete-santangelo | 19 |
| person-priya-nandakumar | person | person-priya-nandakumar | 77 |
| person-rosalind-okafor | person | person-rosalind-okafor | 88 |
| person-tobias-adeyemi-kline | person | person-tobias-adeyemi-kline | 33 |
| person-valeria-montoya | person | person-valeria-montoya | 29 |
