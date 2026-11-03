-- ============================================================
-- SEED: Base de Conocimiento de Belleza para Aura (GlowApp)
-- Tabla: beauty_knowledge_embeddings
-- Metodología: Narrativa empática + rigor científico citado
-- Idempotente: usa ON CONFLICT DO NOTHING sobre (title)
-- ============================================================

-- Asegurar unicidad sobre título para idempotencia
ALTER TABLE beauty_knowledge_embeddings
  ADD CONSTRAINT IF NOT EXISTS uq_beauty_knowledge_title UNIQUE (title);


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 1: SKINCARE / CUIDADO DE LA PIEL
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué es la Niacinamida y por qué debería usarla en mi rutina facial?',
  'Ingredientes > Activos Skincare',
  'La niacinamida (también llamada vitamina B3 o ácido nicotínico) es uno de los activos más versátiles y tolerados que existen en el mundo del skincare. Piensa en ella como la "amiga multiusos" de tu piel: no importa si tu preocupación es el acné, los poros dilatados, las manchas o simplemente querer una piel más luminosa, la niacinamida tiene algo para ofrecerte.

Científicamente, su acción está bien documentada: fortalece la barrera cutánea al estimular la producción de ceramidas y proteínas estructurales, lo que reduce la pérdida de agua transepidérmica. Además, inhibe la transferencia de melanosomas (las "fábricas" del pigmento) a las células de la piel, lo que ayuda a unificar el tono con uso regular. Estudios publicados en el Journal of Cosmetic Dermatology y avalados por la AAD confirman que concentraciones del 2–5% son efectivas para reducir la hiperpigmentación y la inflamación sin irritar.

Lo más bacano de este ingrediente es que es compatible con casi todo: puedes usarla mañana y noche, combinada con ácido hialurónico, retinol o vitamina C. Es especialmente recomendada para pieles sensibles que no toleran bien los ácidos exfoliantes. Si estás empezando con el skincare activo, la niacinamida al 5% es uno de los mejores puntos de partida. ✨',
  '{
    "SkinType": ["Oily", "Dry", "Combination", "Sensitive", "Normal"],
    "Concern": ["Acne", "Hyperpigmentation", "Enlarged_Pores", "Dullness", "Barrier_Repair"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "Journal of Cosmetic Dermatology; AAD Guidelines",
    "SafetyConcerns": "Ninguno a concentraciones estándar (2-5%)",
    "Keywords": ["niacinamida", "vitamina B3", "poros", "manchas", "barrera"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo introducir el retinol en mi rutina sin que me irrite la piel?',
  'Ingredientes > Activos Skincare',
  'El retinol es el ingrediente más estudiado para el antienvejecimiento, pero también el que más fama tiene de ser difícil de usar al principio. Que te ponga roja o te descame las primeras semanas no es señal de que esté haciendo daño, sino de que tu piel se está adaptando. En el mundo del skincare esto tiene hasta nombre: "purge" o período de ajuste.

El secreto para sobrevivir a esta etapa está en empezar DESPACIO. La regla de oro es: empieza con la concentración más baja disponible (0.025% o 0.1%), úsala solo dos noches por semana durante las primeras tres semanas, y luego aumenta gradualmente la frecuencia. Siempre aplícalo por la noche (el retinol se degrada con la luz UV) y NUNCA sin protector solar al día siguiente. La piel en período de adaptación es mucho más sensible a la fotosensibilización.

Una técnica que funciona muy bien para las pieles más reactivas es el "sandwich": limpiador → hidratante ligero → retinol → hidratante más denso. El hidratante actúa como buffer y reduce la irritación sin bloquear la efectividad. Fuentes como la AAD y el Journal of the American Academy of Dermatology respaldan que el retinol al 0.5% usado de manera consistente produce mejoras visibles en textura, líneas y manchas en 12 semanas. ✨',
  '{
    "SkinType": ["All"],
    "Concern": ["Aging", "Fine_Lines", "Texture", "Hyperpigmentation"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "AAD; JAAD; J. Cosmetic Dermatology",
    "SafetyConcerns": "Fotosensibilizante. Contraindicado en embarazo.",
    "Keywords": ["retinol", "retinoide", "antienvejecimiento", "arrugas", "rutina noche"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Para qué sirve el Ácido Hialurónico y cómo lo uso correctamente?',
  'Ingredientes > Humectantes',
  'El ácido hialurónico (AH) es una molécula que produce naturalmente tu propio cuerpo, especialmente en la piel y las articulaciones. Su superpoder es la hidratación: puede retener hasta 1,000 veces su peso en agua. Imagínalo como una esponja microscópica que atrapa la humedad y la mantiene en tu piel durante horas.

Existe en varios pesos moleculares: el de alto peso molecular actúa en la superficie creando una película hidratante inmediata y visible; el de bajo peso molecular penetra más profundo y trabaja desde adentro. Los mejores sérums suelen combinar ambos. Se aplica sobre la piel ligeramente húmeda (justo después de lavarte la cara) para que tenga humedad que "atrapar", y se sella con una crema hidratante encima para que no se evapore.

Un mito muy común: "el ácido hialurónico hidrata por sí solo". Ojo pues 👀, en ambientes muy secos puede ocurrir el efecto contrario: extraer humedad de las capas más profundas de tu piel hacia la superficie donde luego se evapora. Por eso es tan importante sellarlo con un emoliente encima. Funciona para TODOS los tipos de piel, incluyendo la grasa, ya que proporciona hidratación sin sensación pesada ni comedogénica.',
  '{
    "SkinType": ["All"],
    "Concern": ["Dryness", "Plumpness", "Barrier_Support"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "Frontiers in Medicine; CeraVe Scientific Review",
    "SafetyConcerns": "Ninguno. Compatible con todo.",
    "Keywords": ["acido hialuronico", "hidratacion", "serum", "humectante", "piel seca"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Vitamina C en skincare: cuándo y cómo sacarle el máximo partido?',
  'Ingredientes > Antioxidantes',
  'La vitamina C es el escudo antioxidante más poderoso que puedes darle a tu piel. Su función principal es neutralizar los radicales libres generados por la exposición solar, la contaminación y el estrés ambiental, factores que aceleran el envejecimiento prematuro. Además, inhibe la tirosinasa, la enzima que produce melanina, ayudando a reducir manchas oscuras y a dar luminosidad de manera progresiva.

La forma más estable y estudiada es el L-ascorbic acid, aunque es también la más inestable: se oxida rápido al exponerse al aire y la luz (cuando tu suero se pone amarillo o naranja intenso, es señal de que se ha oxidado y perdió potencia). Para evitarlo, búscalo en frascos opacos o con dosificador que minimice el contacto con el aire. Las formulaciones modernas con derivados como ascorbil glucósido o ascorbil fosfato de sodio son más estables aunque ligeramente menos potentes.

Lo ideal es usarla por la MAÑANA, antes del protector solar, para maximizar su efecto antioxidante durante el día. La concentración efectiva está entre 10–20%. Empieza con 10% si tu piel es sensible. Puede combinarse con niacinamida sin problemas en la mayoría de formulaciones modernas. No la uses al mismo tiempo que el retinol (déjalo para la noche). 🌿',
  '{
    "SkinType": ["All"],
    "Concern": ["Hyperpigmentation", "Dullness", "Aging", "Antioxidant_Protection"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "CeraVe; Dermatology Times; Image Skincare",
    "SafetyConcerns": "Puede sensibilizar si se combina incorrectamente con retinol.",
    "Keywords": ["vitamina C", "ascorbico", "luminosidad", "manchas", "antioxidante", "rutina mañana"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué son los AHAs y BHAs y cuál necesito según mi tipo de piel?',
  'Ingredientes > Exfoliantes Químicos',
  'Los exfoliantes químicos son activos que disuelven el "pegamento" que une las células muertas a la superficie de la piel, revelando una piel más fresca, lisa y luminosa por debajo. Son mucho más uniformes y menos traumáticos que el scrub físico (esas bolitas o partículas abrasivas), que pueden crear microheridas invisibles.

Los AHAs (alfa-hidroxiácidos) como el ácido glicólico y el ácido láctico son solubles en agua. Actúan en la superficie de la piel, mejorando la textura, la luminosidad y reduciendo manchas. Son ideales para pieles secas, maduras o con textura rugosa. El ácido láctico es el más suave del grupo y perfecto para empezar.

Los BHAs (beta-hidroxiácidos), principalmente el ácido salicílico, son liposolubles. Esto significa que pueden penetrar dentro del poro y limpiar el exceso de sebo y la queratina acumulada que genera puntos negros y granos. Son los mejores aliados para la piel grasa, mixta o propensa al acné.

¿No sabes cuál elegir? Si tus principales preocupaciones son granos y poros obstruidos → BHA. Si es textura rugosa, opacidad o manchas → AHA. Si tienes ambas → existen combinaciones. Ojo: no los uses todos los días. Dos o tres veces por semana es suficiente. Y protector solar al día siguiente, siempre. 💅',
  '{
    "SkinType": ["Oily", "Combination", "Dry"],
    "Concern": ["Acne", "Texture", "Enlarged_Pores", "Dullness", "Hyperpigmentation"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "AAD; Quora Dermatology Community; Desert Essence",
    "SafetyConcerns": "Fotosensibilizantes. No usar a diario. Evitar en embarazo (ácido salicílico).",
    "Keywords": ["AHA", "BHA", "acido glicólico", "acido salicilico", "exfoliacion quimica", "poros", "acne"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cuántas veces debo lavar mi cara al día y cómo hacerlo bien?',
  'Rutinas > Skincare Básico',
  'La respuesta corta: dos veces al día, mañana y noche. Pero hay más matices de lo que parece. Lavar más no significa piel más limpia; de hecho, lavarte la cara más de dos veces puede eliminar los lípidos naturales que protegen tu barrera cutánea, causando que la piel grasa produzca incluso más sebo como mecanismo de compensación.

Por la mañana, si tu piel no es muy grasa, puedes con agua tibia o un limpiador muy suave, casi como un "enjuague" para remover lo que produciste durante la noche. Por la noche es el lavado importante: aquí sí necesitas un buen limpiador que remueva el protector solar, el maquillaje, el smog y los residuos del día. Si usas protector solar mineral o maquillaje resistente, el doble limpieza (primero aceite o micellar, luego espuma o gel) es la opción más efectiva.

El limpiador debe ser de pH balanceado (entre 4.5 y 6.5, cercano al pH natural de la piel). Un limpiador alcalino, como el jabón de barra tradicional, puede alterar el microbioma cutáneo y resecar. El agua tibia es ideal; el agua muy caliente dilata los vasos y puede empeorar la rojez en pieles sensibles. Termina siempre con agua fría para cerrar levemente los poros. 🌿',
  '{
    "SkinType": ["All"],
    "Concern": ["Cleansing", "Barrier_Repair", "Acne", "General_Routine"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "CeraVe; AAD; Desmark Arte",
    "SafetyConcerns": "Ninguno si se usa el producto adecuado.",
    "Keywords": ["limpieza facial", "lavado cara", "doble limpieza", "limpiador", "rutina basica", "piel grasa"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿El protector solar es obligatorio aunque esté nublado o en casa?',
  'Rutinas > Fotoprotección',
  'Sí. Punto. Aunque parezca drástico, los dermatólogos de todo el mundo lo tienen clarísimo: el protector solar de amplio espectro (UVA + UVB) es el paso más importante del skincare para prevenir el envejecimiento prematuro, las manchas y reducir el riesgo de daño acumulativo de la piel.

¿Por qué en días nublados? Las nubes bloquean hasta el 80% de la radiación visible, pero los rayos UVA (los responsables del envejecimiento y la penetración profunda) atraviesan las nubes y el vidrio sin problema. Los UVB (los que producen quemaduras) sí se reducen, pero los UVA son igual de activos. ¿Y en casa? Si trabajas cerca de una ventana, estás recibiendo UVA. Si usas pantallas todo el día, hay evidencia emergente sobre la luz azul (HEV) y su relación con la hiperpigmentación en pieles de tono oscuro.

¿SPF 30 o 50? SPF 30 bloquea ~97% de UVB, el 50 bloquea ~98%. La diferencia parece pequeña pero es relevante con exposición prolongada. Lo más importante no es el número: es RE-APLICAR cada 2 horas si estás al sol. En casa o con mínima exposición, SPF 30 es suficiente. Elige una textura que disfrutes usar (gel, fluido, serum-protector) para que realmente lo apliques todos los días. ✨',
  '{
    "SkinType": ["All"],
    "Concern": ["Aging", "Hyperpigmentation", "Sun_Protection", "Cancer_Prevention"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "AAD; Quora Dermatology; Elle Skincare Guide",
    "SafetyConcerns": "Ninguno. Esencial para todos.",
    "Keywords": ["protector solar", "SPF", "fotoproteccion", "UVA", "UVB", "manchas", "rutina diaria"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo identifico mi tipo de piel y qué significa cada uno?',
  'Tipos de Piel > Diagnóstico',
  'Conocer tu tipo de piel es el primer paso para elegir productos que realmente funcionen y no desperdiciar dinero en cosas que no son para ti. La clasificación más usada (y validada por la Academia Americana de Dermatología) distingue cinco tipos básicos:

🔹 Piel Normal: Poros pequeños, textura uniforme, sin brillo excesivo ni tirantez. Produce sebo de manera equilibrada. Es la menos común de lo que la gente cree.
🔹 Piel Seca: Se siente tirante después de lavar, tiene aspecto opaco y a veces se escama. Le cuesta retener humedad. Necesita ingredientes oclusivos y emolientes.
🔹 Piel Grasa: Brilla generalizado, poros visibles y dilatados, predisposición a granos y puntos negros. Produce sebo en exceso, especialmente en la zona T.
🔹 Piel Mixta: La zona T (frente, nariz, barbilla) es grasa, pero las mejillas son normales o secas. Requiere un enfoque diferenciado por zonas.
🔹 Piel Sensible: Reacciona con enrojecimiento, picor o ardor ante ingredientes específicos, temperaturas o estrés. Puede coexistir con cualquiera de los tipos anteriores.

Un truco para identificarla en casa: lávate la cara, espera 30 minutos sin aplicar nada, y observa. ¿Se ve brillante? → Grasa. ¿Se siente tirante? → Seca. ¿Ambas cosas en distintas zonas? → Mixta. Una clave adicional: el tipo de piel puede cambiar con la edad, el clima, los cambios hormonales y la alimentación. 💅',
  '{
    "SkinType": ["All"],
    "Concern": ["Skin_Diagnosis", "Product_Selection"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "AAD; Viatiara Dermatology; Douglas J. Beauty",
    "Keywords": ["tipo de piel", "piel grasa", "piel seca", "piel mixta", "piel sensible", "diagnostico"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Puedo combinar Niacinamida y Vitamina C en la misma rutina?',
  'Rutinas > Combinación de Activos',
  'Este es uno de los debates más famosos del skincare y la respuesta ha evolucionado con la ciencia. La preocupación histórica era que la niacinamida y la vitamina C (L-ascórbico) podían reaccionar juntas y formar ácido nicotínico, causando enrojecimiento. Sin embargo, investigaciones más recientes demuestran que esta reacción ocurre solo a temperaturas muy altas (superiores a 100°C) y en exposición prolongada: condiciones que no se dan en tu cara. 😄

En la práctica, la gran mayoría de formulaciones modernas son completamente compatibles. Ambos ingredientes se potencian mutuamente: la vitamina C aporta acción antioxidante y reduce manchas, mientras que la niacinamida fortalece la barrera y calma la inflamación. Usados juntos, pueden mejorar la luminosidad y unificar el tono más eficientemente que cualquiera de los dos por separado.

Si aun así prefieres separar, la opción más sencilla es: vitamina C por la mañana (para protección antioxidante durante el día) y niacinamida por la noche. Pero no es estrictamente necesario. Lo que SÍ debes evitar es mezclar en la misma rutina la vitamina C (pH ácido, idealmente < 3.5) con el retinol, ya que trabajan mejor en rangos de pH diferentes y pueden anularse mutuamente.',
  '{
    "SkinType": ["All"],
    "Concern": ["Combination_Actives", "Hyperpigmentation", "Luminosity"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "Keptlist; Image Skincare; CeraVe Scientific",
    "Keywords": ["niacinamida", "vitamina C", "combinar activos", "rutina", "compatibilidad"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué son las ceramidas y por qué son la clave de una piel sana?',
  'Ingredientes > Barrera Cutánea',
  'Las ceramidas son lípidos (grasas) que forman de manera natural la barrera cutánea, esa capa invisible pero fundamental que mantiene la humedad dentro y los agentes irritantes fuera. Representan aproximadamente el 50% del estrato córneo (la capa más externa de la piel). Cuando la piel envejece, está estresada o ha sido agredida por productos muy agresivos, el nivel de ceramidas disminuye y la barrera se vuelve "permeable": la piel pierde agua más fácilmente (fenómeno llamado TEWL - pérdida de agua transepidérmica) y se vuelve más sensible a irritantes externos.

Los productos con ceramidas replican esta estructura natural, ayudando a "reparar los ladrillos" de la barrera. Son especialmente útiles si tienes piel seca, eczema, dermatitis o si notas que tu piel está sensibilizada por haber sobreutilizado activos como ácidos o retinol. También son el complemento ideal para cualquier rutina con activos fuertes: las ceramidas aseguran que la barrera no se vea comprometida mientras los activos hacen su trabajo.

Combínalas con colesterol y ácidos grasos libres (muchos productos ya los incluyen juntos) para una reparación más completa. Las ceramidas son para todos los tipos de piel, especialmente para quienes viven en climas secos o fríos. En Bogotá, con su clima de montaña y viento, una crema con ceramidas es un básico que nunca falla. 🌿',
  '{
    "SkinType": ["Dry", "Sensitive", "All"],
    "Concern": ["Barrier_Repair", "Dryness", "Eczema", "Sensitivity"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "CeraVe; J. Cosmetic Dermatology; Reddit Skincare Community",
    "Keywords": ["ceramidas", "barrera cutanea", "piel seca", "hidratacion", "TEWL", "sensible"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 2: SALUD CAPILAR
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo saber si mi cabello es de alta, media o baja porosidad?',
  'Salud Capilar > Diagnóstico Capilar',
  'Imagina tu cabello como una esponja. Hay esponjas que absorben el agua en segundos (alta porosidad) y otras que el agua resbala por encima como si fuera impermeables (baja porosidad). Esta característica, llamada porosidad, determina qué tipo de "bebida" necesita tu cabello para estar hidratado y fuerte.

La porosidad depende del estado de la cutícula, la capa exterior protectora de cada hebra. La cutícula funciona como las escamas de un pez: cuando están "cerradas" y lisas, la humedad entra difícilmente pero también se retiene bien (baja porosidad). Cuando están "abiertas" o dañadas por el calor, los químicos o el sol, la humedad entra rápido pero también se escapa igual de rápido (alta porosidad), dejando el cabello poroso y fácilmente quebradizo.

🧪 Prueba casera rápida: coloca un mechón de cabello limpio (sin productos) en un vaso de agua. Si se va al fondo rápido → alta porosidad. Si flota en el medio → media porosidad. Si flota arriba indefinidamente → baja porosidad.

¿Qué hago con esta info?
- Baja porosidad: necesita calor para abrir la cutícula y que los productos penetren. Mascarillas con gorro de ducha o vapor. Prefiere productos ligeros.
- Alta porosidad: necesita proteínas para "llenar" los huecos de la cutícula + selladores oclusivos como aceite de coco o manteca de karité para retener la humedad. 💅',
  '{
    "Porosity": ["Low", "Medium", "High"],
    "CurlPattern": ["Straight", "Wavy", "Curly", "Coily"],
    "Concern": ["Hydration", "Breakage", "Frizz", "Hair_Diagnosis"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "Moderate",
    "Source": "NYSCC; Reddit CurlyCommunity; Cosmedica",
    "Keywords": ["porosidad capilar", "cabello", "cutícula", "hidratacion capilar", "diagnostico capilar", "alta porosidad"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cuál es la rutina capilar correcta paso a paso para un cabello sano?',
  'Rutinas > Rutina Capilar',
  'Una rutina capilar efectiva no se trata de usar 10 productos, sino de entender qué hace cada paso y ejecutarlo bien. La Academia Americana de Dermatología propone seis etapas clave:

1️⃣ LIMPIAR: Usa un champú adecuado a tu tipo de cuero cabelludo (no al tipo de cabello). El foco del masaje va en el cuero cabelludo, el resto se limpia por dilución al enjuagar.
2️⃣ ACONDICIONAR: Aplica el acondicionador desde las puntas hacia las zonas medias. Espera 2–3 minutos antes de enjuagar. El cuero cabelludo generalmente no necesita acondicionador.
3️⃣ TRATAR: Una vez por semana (o más si el cabello está dañado), usa una mascarilla. Si tu cabello es de alta porosidad, incluye proteínas; si es de baja porosidad, enfócate en humectantes.
4️⃣ SECAR INTELIGENTE: Termina el enjuague con agua fría para sellar la cutícula y dar brillo. Seca con toalla de microfibra o camiseta de algodón en lugar de toalla tradicional: la fricción de la felpa causa frizz y rotura.
5️⃣ PROTEGER DEL CALOR: Antes de cualquier herramienta caliente (plancha, secador), aplica un protector térmico. El calor sin protección sobre 180°C daña irreversiblemente la proteína de queratina del cabello.
6️⃣ ESTILIZAR: Menos es más. Los productos de estilo (cremas, geles, aceites) se aplican en cabello húmedo para sellar la hidratación. 🌿',
  '{
    "Porosity": ["Low", "Medium", "High"],
    "CurlPattern": ["All"],
    "Concern": ["Hydration", "Frizz", "Breakage", "Hair_Health", "General_Routine"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "AAD; iHerb Hair Guide; Asheville Derm; Augustinus Bader",
    "Keywords": ["rutina capilar", "lavado cabello", "acondicionador", "mascarilla", "protector termico", "cabello sano"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Las proteínas para el cabello: cuándo usarlas y cuándo evitarlas?',
  'Salud Capilar > Tratamientos',
  'Las proteínas capilares (queratina, colágeno hidrolizado, proteína de seda, proteína de trigo) son como el "yeso" que llena los huecos de una cutícula dañada. Cuando el cabello está poroso, quebradizo o con daño por calor o químicos, las proteínas pueden restaurar temporalmente su estructura, mejorar la elasticidad y reducir la rotura.

¿Cuándo SÍ usarlas? Si tu cabello está muy elástico antes de romperse (se estira mucho antes de ceder), o si el agua resbala sin "entrar", o si notas un exceso de caída por rotura → necesitas proteína.

¿Cuándo EVITARLAS? Si el cabello se siente rígido, tieso, pajoso o se rompe sin estirarse primero, puede ser "sobrecarga proteica" (protein overload). En ese caso, necesitas hidratación y dejar los tratamientos proteicos a un lado temporalmente.

El equilibrio proteína-humedad es el concepto central del cuidado capilar avanzado. Son complementarios, no excluyentes. Una mascarilla proteica debe ir seguida siempre de una hidratante, para restaurar el equilibrio. Para el cabello rizado (3A-4C), este balance es especialmente crítico: el patrón de rizo solo se forma bien cuando la fibra tiene tanto estructura (proteína) como flexibilidad (humedad). ✨',
  '{
    "Porosity": ["High", "Medium"],
    "CurlPattern": ["Wavy", "Curly", "Coily"],
    "DamageHistory": ["Moderate", "Severe"],
    "Concern": ["Breakage", "Elasticity", "Protein_Balance", "Chemical_Damage"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "Moderate",
    "Source": "Kanks Store; CurlsAndPotions; NYSCC",
    "Keywords": ["proteinas cabello", "queratina", "sobrecarga proteica", "hidratacion", "balance proteina humedad", "rotura"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Los suplementos para el cabello realmente funcionan? Biotina, colágeno y más',
  'Suplementos > Salud Capilar',
  'El mercado de suplementos para cabello, piel y uñas mueve millones de dólares, pero eso no significa que todos sean igual de efectivos. La verdad está en los matices.

Lo que SÍ tiene evidencia: La biotina (vitamina B7) es esencial para la producción de queratina, la proteína principal del cabello. Pero OJO: su suplementación muestra beneficios claros principalmente cuando hay una deficiencia real de biotina, que en personas sanas con buena alimentación no es tan común. El colágeno hidrolizado combinado con vitamina C ha mostrado en varios ensayos controlados mejorar la densidad del cabello y reducir la caída en mujeres con adelgazamiento moderado (estudios publicados en PMC/NCBI). El zinc y el hierro son los más importantes: su deficiencia es una de las causas más frecuentes y subdiagnosticadas de caída de cabello. Antes de suplementarlos, hazte los exámenes.

Lo que tiene evidencia limitada: La mayoría de los "complexes" capilares multivitamínicos combinan ingredientes en dosis tan bajas que ninguno llega a la concentración efectiva demostrada en estudios. El "biotin gummy" de tendencia en redes tiene evidencia clínica muy débil si no hay deficiencia.

⚠️ Precaución: Los suplementos no están exentos de riesgos. Dosis altas de vitamina A son teratogénicas. El hierro en exceso puede ser tóxico. Consulta siempre con un médico antes de suplementarte, especialmente en embarazo o lactancia. La base es siempre la alimentación completa: proteínas, hierro, zinc, vitaminas del complejo B. 🌿',
  '{
    "TargetArea": ["Hair", "Nails"],
    "KeyIngredients": ["Biotin", "Collagen", "Zinc", "Iron", "Vitamin_D"],
    "ScientificEvidence": "Moderate",
    "SafetyConcerns": "Vitamina A: teratogénica. Hierro: toxicidad en dosis altas. Consultar médico.",
    "DifficultyLevel": "Intermediate",
    "Source": "JAAD; PMC NCBI; Badass Beard Care; ResearchGate",
    "Keywords": ["suplementos cabello", "biotina", "colageno", "zinc", "caida cabello", "nutricion"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo cuidar el cuero cabelludo para prevenir la caída y la caspa?',
  'Salud Capilar > Cuero Cabelludo',
  'El cuero cabelludo es literalmente el suelo donde crece tu cabello. Si el suelo no está sano, la planta tampoco lo estará. El enfoque moderno del cuidado capilar pone al cuero cabelludo como protagonista, y no como un simple punto de partida para limpiar.

Un cuero cabelludo sano tiene una barrera cutánea intacta y un microbioma equilibrado. Cuando se desequilibra, aparecen problemas como la caspa (que en la mayoría de los casos está causada por el hongo Malassezia globosa), la seborrea, la picazón o la caída acelerada. La caspa no tiene que ver con falta de higiene: puede aparecer incluso en personas que se lavan el cabello todos los días. Los champús con piritionato de zinc o ketoconazol son los ingredientes más respaldados clínicamente para controlarla.

El estrés oxidativo es otro factor clave: la contaminación y la radiación UV degradan los folículos pilosos, acelerando la caída. Los serums de cuero cabelludo con antioxidantes (vitamina E, niacinamida, extracto de té verde) han mostrado en ensayos clínicos mejorar la condición del folículo y reducir la caída. El masaje capilar, por su parte, estimula la circulación y ha mostrado en estudios de la Journal of Dermatological Science mejorar el grosor del cabello con 4 minutos diarios de masaje.

Frecuencia de lavado: no hay una regla única. Lávalo cuando lo necesites, usando agua tibia y dedicando tiempo real al masaje del cuero cabelludo. 💅',
  '{
    "Porosity": ["All"],
    "Concern": ["Hair_Loss", "Dandruff", "Scalp_Health", "Seborrhea"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "MD Hair Co; PMC NCBI; PubMed Scalp Antioxidants Study",
    "Keywords": ["cuero cabelludo", "caspa", "caida cabello", "seborrea", "folículo", "masaje capilar", "antioxidantes"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 3: ESTÉTICA FACIAL
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué es el análisis de color por estaciones y cómo saber cuál me corresponde?',
  'Estética Facial > Colorimetría y Visagismo',
  'El análisis de las 4 estaciones es un sistema de colorimetría que agrupa a las personas en cuatro paletas de colores —Primavera, Verano, Otoño e Invierno— basándose en la combinación de tres características naturales: el tono de piel (y sus subtonos), el color del cabello y el color de los ojos. El objetivo es identificar qué colores hacen que tu piel luzca más luminosa, tus ojos más vivos y tu apariencia más armoniosa en general.

🌸 PRIMAVERA: Subtonos cálidos y dorados. Piel clara-media con un glow melocotón o dorado. Cabello rubio miel, castaño claro o cobrizo. Ojos azules, verdes o miel. Sus colores: coral, durazno, turquesa, colores brillantes y cálidos.
☁️ VERANO: Subtonos fríos y rosados. Piel pálida-media con un subtono rosa-azul. Cabello cenizo o rubio oscuro apagado. Ojos grises, azules suaves o verdes grises. Sus colores: lavanda, azul polvo, malva, tonos suaves y fríos.
🍂 OTOÑO: Subtonos cálidos y dorados intensos. Piel media a oscura con tono oliva o dorado. Cabello cobrizo, castaño oscuro, rojizo. Ojos ámbar, avellana o verde oscuro. Sus colores: terracota, naranja, ocre, verde musgo.
❄️ INVIERNO: Subtonos fríos y neutros o azulados. Contraste alto entre piel y cabello. Piel pálida o muy oscura. Cabello negro o rubio muy claro. Ojos muy oscuros o azul intenso. Sus colores: negro, blanco puro, fucsia, azul eléctrico.

⚠️ Importante: este sistema es una herramienta orientativa, no una regla absoluta. No funciona perfectamente para todos. La autoexpresión personal siempre va primero: usa los colores que te hagan sentir chévere. ✨',
  '{
    "Undertone": ["Warm", "Cool", "Neutral"],
    "SeasonalPalette": ["Spring", "Summer", "Autumn", "Winter"],
    "EyeColor": ["Blue", "Green", "Brown", "Grey", "Hazel"],
    "ContrastLevel": ["High", "Low", "Medium"],
    "Concern": ["Color_Analysis", "Personal_Styling"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "Limited",
    "Source": "CurateYourStyle; ColorMeBeautiful; GabrielleArruda",
    "Keywords": ["colorimetria", "analisis color", "estaciones", "primavera", "verano", "otoño", "invierno", "subtono", "paleta"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo elegir la forma y diseño de mis cejas según la forma de mi cara?',
  'Estética Facial > Cejas y Visagismo',
  'Las cejas son el marco del cuadro: pueden cambiar completamente tu apariencia. El visagismo, la ciencia que estudia la armonía entre el rostro y las elecciones estéticas, tiene principios claros para guiar el diseño de cejas según la geometría de tu cara.

🔵 Cara redonda: Para añadir altura y angularidad. Busca una ceja con arco alto y marcado, ligeramente arqueada. Evita cejas muy redondeadas que enfaticen la redondez.
⬛ Cara cuadrada: Para suavizar ángulos pronunciados en la mandíbula. Una ceja curva y suave, con arco moderado, equilibra los ángulos fuertes. Evita cejas rectas y angulares.
🔷 Cara ovalada: La más versátil. Casi cualquier forma funciona. Se recomienda una ceja ligeramente arqueada que mantenga la armonía natural.
🔺 Cara corazón o triángulo invertido: Frente amplia, mentón estrecho. Una ceja baja y con poco arco, casi plana, equilibra la frente visualmente.
🔻 Cara cuadrada-rectangular: Similar a la redonda, el arco alto añade proporciones más equilibradas.

Más allá de la forma, el grosor también importa: cejas gruesas tienen un efecto juvenil y enmarca más el ojo; cejas muy delgadas pueden hacer los rasgos más "duros". La tendencia 2025-2026 privilegia cejas naturales y definidas, con laminado o pomada, sin sobre-depilación. 💅',
  '{
    "Concern": ["Brow_Shape", "Facial_Harmony", "Visagism"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "Moderate",
    "Source": "FaceBeautyScience; BeautyHunterUA; PMC Facial Aesthetics",
    "Keywords": ["cejas", "visagismo", "forma cara", "diseño cejas", "laminado cejas", "estética facial"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cuál es la diferencia entre los serums de pestañas con prostaglandinas y los peptídicos?',
  'Estética Facial > Pestañas y Cejas',
  'Los serums para el crecimiento de pestañas se dividen en dos categorías con diferencias muy importantes en efectividad y seguridad.

🔬 SERUMS CON ANÁLOGOS DE PROSTAGLANDINAS (ej. bimatoprost, isopropyl cloprostenate):
→ ¿Cómo funcionan? Prolongan la fase de crecimiento activo (fase anágena) del ciclo capilar de la pestaña, lo que resulta en pestañas más largas, oscuras y densas.
→ Efectividad: Alta. El bimatoprost está aprobado por la FDA bajo prescripción médica (Latisse®).
→ Riesgos: Significativos. El uso prolongado puede causar oscurecimiento de la piel periorbitaria (hiperpigmentación alrededor del ojo), pérdida de volumen de grasa en el párpado dando un aspecto hundido o cansado, y en casos raros, cambios en el color del iris. En muchos países su venta sin receta está restringida.

🧬 SERUMS PEPTÍDICOS (sin prostaglandinas):
→ ¿Cómo funcionan? Contienen péptidos (cadenas cortas de aminoácidos) que actúan como mensajeros para estimular la salud del folículo piloso y la producción de queratina. También incluyen ingredientes nutritivos como biotina y pantenol.
→ Efectividad: Moderada. Los resultados son más lentos (3-4 meses vs 6-8 semanas de los de prostaglandinas), pero los resultados pueden mantenerse con uso continuado.
→ Riesgos: Mínimos. Son la opción más segura para uso prolongado.

Si buscas resultados dramáticos y rápidos, los de prostaglandinas (bajo supervisión médica) son más efectivos. Si priorizas la seguridad a largo plazo, los peptídicos son la opción responsable. ✨',
  '{
    "Concern": ["Eyelash_Growth", "Brow_Growth", "Safety"],
    "ApplicationMethod": ["Topical_Serum"],
    "ScientificEvidence": "High",
    "SafetyConcerns": "Prostaglandinas: hiperpigmentación, pérdida de grasa periorbitaria, cambio color iris. Requieren supervisión médica.",
    "DifficultyLevel": "Advanced",
    "Source": "PubMed Lash Serums; ProLash.com; WowBrow Cosmetics; Reddit Skincare",
    "Keywords": ["serum pestañas", "prostaglandinas", "peptidos", "crecimiento pestañas", "bimatoprost", "latisse", "seguridad"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 4: MANICURA Y UÑAS
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué daña menos las uñas: el gel, el acrílico o el polvo dip?',
  'Manicura > Tipos de Uñas',
  'Las tres opciones son seguras cuando se aplican y retiran correctamente. La clave está en el proceso de remoción, que es donde más daño ocurre si se hace mal.

💅 GEL: Es el sistema más amigable con la uña natural. Se endurece bajo lámpara UV/LED y se retira sumergiéndola en acetona pura con algodón envuelto durante 10-15 minutos. Si se hace correctamente (sin raspar ni arrancar), el daño a la lámina es mínimo. La exposición a UV del curado no representa riesgo significativo con uso regular, pero aplicar protector solar en las manos antes de la lámpara es una buena práctica.

🪨 ACRÍLICO: El más duradero y el más resistente al impacto. Se mezcla polvo + monómero líquido. El monómero puede ser irritante para pieles sensibles y tiene un olor fuerte. El mayor riesgo es la remoción incorrecta: raspar o arrancar el acrílico arranca capas de la lámina ungueal con él. La remoción siempre debe ser con lima eléctrica + acetona, nunca a la fuerza.

✨ POLVO DIP: No requiere lámpara UV. Se sumerge la uña en polvo de color y se sella con activador y top coat. Considerado generalmente menos dañino que el acrílico porque no usa monómero líquido. El riesgo es higiénico: si el mismo frasco de polvo se comparte entre clientes, puede transmitir hongos. Un buen salón vierte el polvo sin meter el dedo en el frasco.

Conclusión: Para uñas naturales débiles → gel. Para duración extrema → acrílico (con cuidado en la remoción). Para un intermedio → dip powder. 🌿',
  '{
    "ApplicationMethod": ["Gel", "Acrylic", "Dip_Powder"],
    "DurabilityNeeds": ["Short-term", "Long-term"],
    "UVProtection": ["Required_for_Gel"],
    "AllergenRisk": ["Monomer_Sensitivity_Acrylic"],
    "Concern": ["Nail_Health", "Nail_Damage", "Manicure_Choice"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "Moderate",
    "Source": "NailSami; Virgo & Gem Nails; Dermatology Times",
    "Keywords": ["gel uñas", "acrílico", "polvo dip", "manicura", "daño uñas", "remocion", "salud uñas"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo mantener las uñas sanas entre visita y visita al salón?',
  'Manicura > Cuidado en Casa',
  'El tiempo entre citas es tan importante como la manicura misma para mantener unas uñas sanas y fuertes a largo plazo. Aquí van los cuidados que realmente hacen diferencia:

🔑 LOS BÁSICOS:
- Mantén las uñas cortas: las uñas largas tienen mayor palanca y son más propensas a romperse al golpear superficies.
- Córtalas rectas por el borde superior y redondea ligeramente las esquinas para evitar que se enganchen.
- Mantén las uñas SECAS entre lavados: la humedad prolongada debilita la lámina. Usa guantes para tareas de limpieza o lavado de platos.
- Nunca cortes las cutículas: actúan como barrera protectora contra infecciones y hongos. Solo empújalas suavemente hacia atrás con un palito de naranjo después de la ducha, cuando están blandas.

💊 NUTRICIÓN DE LA UÑA:
- Aplica aceite de cutícula (con vitamina E, aceite de jojoba o argán) al menos una vez al día, especialmente de noche. Hidrata la cutícula y el hiponiquio, mejorando la flexibilidad de la lámina.
- Si usas fortalecedores, busca los que contienen queratina, calcio o biotina. Evita los que contienen formaldehído en altas concentraciones: pueden hacer la uña más rígida a corto plazo pero más frágil a largo plazo.

🚫 LO QUE DEBES EVITAR:
- Usar las uñas como herramientas (para abrir anillos de lata, raspar, etc.).
- Morder o jalar la cutícula.
- Retirar el gel o el acrílico arrancándolo tú mismo/a en casa sin acetona. 💅',
  '{
    "ApplicationMethod": ["Natural", "Post-manicure"],
    "Concern": ["Nail_Health", "Nail_Strengthening", "Cuticle_Care"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "Moderate",
    "Source": "Dermatology Times; Cosmopolitan Beauty; AAD Nail Care",
    "Keywords": ["cuidado uñas", "cutícula", "aceite cutícula", "fortalecedor uñas", "uñas sanas", "manicura casa"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 5: COLORACIÓN CAPILAR Y SEGURIDAD
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Por qué debo hacer la prueba de alergia antes de teñirme el cabello?',
  'Coloración Capilar > Seguridad y Regulación',
  'La prueba de parche o prueba de alérgenos es uno de los pasos más importantes —y más ignorados— antes de teñirse el cabello. No es un formalismo del salón: puede literalmente salvarte de una reacción alérgica severa.

¿Cuál es el ingrediente problemático? La p-fenilendiamina (PPD), presente en la gran mayoría de los tintes permanentes y semipermanentes oscuros. La PPD es un alérgeno potente reconocido como tal por la Unión Europea (Reglamento CE 1223/2009), que exige que todos los productos que la contengan incluyan advertencias explícitas en el envase. En Colombia, aunque la regulación del INVIMA sigue estándares similares, la supervisión varía por establecimiento.

La sensibilización a la PPD puede desarrollarse en cualquier momento de la vida, incluso si te has teñido el cabello durante años sin problema. Una reacción alérgica a la PPD puede ir desde urticaria y picazón hasta edema (hinchazón severa del rostro y párpados) que requiere atención de urgencias.

✅ Cómo hacer la prueba correctamente:
1. Mezcla una pequeña cantidad del tinte (siguiendo las instrucciones del fabricante).
2. Aplica detrás de la oreja o en el pliegue del codo.
3. Deja sin cubrir durante 48 horas.
4. Si aparece enrojecimiento, picazón, ampolla o cualquier reacción → no te apliques el tinte. Consulta con un dermatólogo.

⚠️ No te tiñas si tienes el cuero cabelludo irritado, heridas abiertas o erupción en la cara o cuello. 🌿',
  '{
    "AllergenRisk": ["PPD", "High"],
    "Concern": ["Allergy_Safety", "Hair_Coloring_Safety", "Regulatory_Compliance"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "CosмileEurope; EC Regulation 1223/2009; Biorius; EC.Europa.eu",
    "Keywords": ["PPD", "alergia tinte", "prueba parche", "coloracion capilar", "seguridad tinte", "fenilendiamina", "reaccion alérgica"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué tipos de tintes capilares existen y cuál es el más adecuado para mí?',
  'Coloración Capilar > Tipos de Tintes',
  'No todos los tintes son iguales y elegir el tipo correcto puede marcar la diferencia entre un resultado que dure semanas o meses, y entre un proceso más o menos dañino para tu fibra capilar.

🎨 TEMPORAL: Deposita el color en la superficie de la cutícula sin penetrar. Se va en 1-3 lavados. Ideal para probar un color sin compromiso. Muy bajo daño.

🎨 SEMIPERMANENTE: Penetra levemente en la corteza sin oxidantes fuertes. Dura 6-12 lavados. Puede intensificar el tono natural o añadir reflejos, pero NO puede aclarar. Bajo daño. Ideal para pieles sensibles.

🎨 DEMI-PERMANENTE: Usa oxidante pero en concentración muy baja (3-6 vol). Más cobertura que el semipermanente, dura 12-24 lavados. No puede aclarar más de 1-2 tonos. Daño moderado-bajo. Excelente para cubrir canas parcialmente.

🎨 PERMANENTE: Usa peróxido de hidrógeno (20-40 vol) para abrir la cutícula y permitir que los precursores de color penetren y reaccionen, creando moléculas grandes que quedan "atrapadas" en la corteza. Puede aclarar o cambiar el tono radicalmente. Dura hasta 6-8 semanas (luego sale la raíz). Mayor daño potencial a la fibra si se solapan aplicaciones.

¿Cuál elegir? Si solo quieres tonificar → semipermanente o demi. Si quieres cambio radical o cobertura total de canas → permanente. Para cabellos de alta porosidad o muy dañados, minimiza el uso de permanentes y prioriza tratamientos de queratina entre aplicaciones. 💅',
  '{
    "BaseColor": ["Light", "Medium", "Dark"],
    "DamageHistory": ["Light", "Moderate", "Severe"],
    "DesiredResult": ["Natural", "Bold", "Subtle_Tone_Change", "Gray_Coverage"],
    "Concern": ["Hair_Coloring", "Damage_Prevention"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "CHI Education; Education.Chi.com; CosмileEurope",
    "Keywords": ["tipos tinte", "tinte permanente", "semipermanente", "demi permanente", "coloracion capilar", "canas", "daño capilar"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- ══════════════════════════════════════════════════════════════
-- BLOQUE 6: RUTINAS Y FILOSOFÍA
-- ══════════════════════════════════════════════════════════════

INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué es el skinimalism y cómo armar una rutina simple pero poderosa?',
  'Rutinas > Filosofía Skincare',
  'El skinimalism es el movimiento que desafió la cultura de las rutinas de 10 pasos y propone algo radical: menos es más. No se trata de ser perezosa o perezoso, sino de ser estratégico/a: elegir pocos productos de alta calidad con ingredientes respaldados por ciencia en lugar de acumular decenas de cosas que se contradicen entre sí o sobrecargan la piel.

La base del skinimalism descansa en tres pilares:
1. Limpieza suave (que no agrede la barrera)
2. Hidratación efectiva (que repara y sella)
3. Protección solar diaria (sin excusas)

Todo lo demás es opcional y debe añadirse de uno en uno, esperando al menos 2-3 semanas antes de incorporar el siguiente. Este método permite identificar claramente qué producto hace qué efecto en tu piel, y cuál podría estar causando problemas.

La rutina mínima poderosa:
🌅 MAÑANA: Limpiador suave → Serum de vitamina C (opcional) → Hidratante ligero → Protector solar SPF 30+
🌙 NOCHE: Limpiador suave → Activo (retinol o niacinamida, no ambos al inicio) → Crema hidratante con ceramidas

Eso es todo lo que necesitas para ver cambios reales. La constancia siempre supera al número de productos. Una rutina que puedas seguir todos los días durante meses es infinitamente más efectiva que una de 12 pasos que abandonas a la tercera semana. ✨',
  '{
    "SkinType": ["All"],
    "Concern": ["General_Routine", "Minimalism", "Beginner_Skincare"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "High",
    "Source": "DrugstoreNews Skinimalism; Elle Skincare; CeraVe",
    "Keywords": ["skinimalism", "rutina minimalista", "rutina basica", "menos productos", "principiantes skincare", "protector solar"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué son los suplementos de colágeno y para qué sirven realmente?',
  'Suplementos > Piel y Uñas',
  'El colágeno es la proteína más abundante del cuerpo humano: forma el andamiaje estructural de la piel, los tendones, los cartílagos y los huesos. A partir de los 25 años, la producción natural comienza a disminuir gradualmente (~1% por año), lo que se manifiesta en una piel menos firme y más propensa a arrugas finas.

¿Los suplementos orales de colágeno funcionan? Aquí la ciencia es más matizada de lo que el marketing sugiere. El colágeno que ingieres no llega intacto a tu piel: las enzimas digestivas lo rompen en aminoácidos y péptidos. El debate científico es si esos péptidos específicos (especialmente los hidrolizados) envían señales a los fibroblastos para producir más colágeno propio. Varios estudios randomizados controlados publicados en PMC/NCBI muestran mejoras estadísticamente significativas en la elasticidad y la hidratación de la piel con péptidos de colágeno hidrolizado (2.5–10g/día) durante 8-12 semanas. También hay evidencia para reducción de la rotura de uñas.

Lo que SÍ está claro: para que el colágeno funcione (tanto el ingerido como el producido endógenamente), necesitas vitamina C. La vitamina C es cofactor esencial en la síntesis de colágeno; sin ella el proceso no se completa. Por eso los mejores suplementos de colágeno incluyen vitamina C en su fórmula.

⚠️ Regulación: La EFSA (Unión Europea) no ha autorizado afirmaciones directas como "reduce arrugas" para suplementos. Las permitidas son más genéricas, ligadas al bienestar articular o piel normal. Elige marcas con certificaciones de terceros (NSF, Informed Sport) que garanticen la pureza del producto. 🌿',
  '{
    "TargetArea": ["Skin", "Nails", "Hair"],
    "KeyIngredients": ["Collagen", "Vitamin_C", "Hydrolyzed_Peptides"],
    "ScientificEvidence": "Moderate",
    "SafetyConcerns": "Bajo. Consultar en enfermedades autoinmunes o alergias al marisco (colágeno marino).",
    "DifficultyLevel": "Intermediate",
    "Source": "PMC NCBI Collagen Studies; EFSA; Nutritional Outlook",
    "Keywords": ["colageno", "suplementos colageno", "elasticidad piel", "arrugas", "péptidos", "vitamina C"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Cómo proteger el cabello del daño por calor de planchas y secadores?',
  'Salud Capilar > Protección Capilar',
  'El calor es uno de los principales enemigos de la fibra capilar. Las planchas de pelo, los rizadores y los secadores funcionan por encima de los 150°C, y a esas temperaturas la queratina —la proteína que compone el 90% del cabello— comienza a desnaturalizarse: pierde su estructura tridimensional y la fibra se vuelve porosa, opaca y propensa a la rotura. El daño es acumulativo e irreversible sin un corte.

🛡️ PROTECTOR TÉRMICO: Es el escudo indispensable. Aplícalo SIEMPRE antes de cualquier herramienta de calor, en cabello húmedo o seco según el tipo de protector. Busca productos que mencionen protección hasta 230°C y que contengan ingredientes como dimeticona, aceite de argán, ciclometicona o proteínas hidrolizadas. Un buen protector térmico puede reducir hasta un 50% el daño por calor.

🌡️ TEMPERATURA INTELIGENTE:
- Cabello fino o dañado: máximo 150-170°C
- Cabello grueso o rizado: 180-200°C (con protector)
- Nunca sobre 230°C: el daño es severo independientemente del tipo

💧 OTROS HÁBITOS QUE MARCAN DIFERENCIA:
- Seca el cabello al 80% con secador antes de usar plancha: aplicar calor sobre cabello muy húmedo crea "burbujas" de vapor dentro de la fibra que la revientan.
- No pases la plancha por el mismo mechón más de 2 veces.
- Usa planchas con placas de titanio o cerámica: distribuyen el calor de manera más uniforme que las de acero. ✨',
  '{
    "Porosity": ["Medium", "High"],
    "DamageHistory": ["Light", "Moderate", "Severe"],
    "CurlPattern": ["Straight", "Wavy", "Curly"],
    "Concern": ["Heat_Damage", "Breakage", "Hair_Protection"],
    "DifficultyLevel": "Beginner",
    "ScientificEvidence": "Moderate",
    "Source": "Instagram Hair Science; AAD Heat Styling Guide",
    "Keywords": ["daño calor", "plancha cabello", "protector termico", "queratina", "secador", "cabello dañado", "temperatura plancha"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


INSERT INTO beauty_knowledge_embeddings (title, category, content, metadata)
VALUES (
  '¿Qué es la regulación de cosméticos y por qué importa al comprar productos de belleza?',
  'Regulación y Seguridad > Marco Regulatorio',
  'Cuando compras un producto de belleza, existe todo un marco legal que en teoría garantiza que lo que estás aplicando en tu piel es seguro. Pero la realidad es más compleja de lo que parece, y entender los básicos puede protegerte de productos fraudulentos o potencialmente dañinos.

🇺🇸 EN ESTADOS UNIDOS: La FDA regula los cosméticos pero históricamente con menos rigurosidad que los medicamentos. En 2022 se aprobó la Ley MoCRA (Modernization of Cosmetics Regulation Act), que introduce nuevas obligaciones: registro obligatorio de instalaciones y productos, reporte de efectos adversos graves, y mayor facultad para retirar productos del mercado.

🇪🇺 EN EUROPA: El Reglamento CE 1223/2009 es considerado el marco más estricto del mundo. Prohíbe o restringe miles de ingredientes. El nuevo Reglamento UE 2026/909 introduce restricciones adicionales para 12 ingredientes cosméticos, incluyendo nuevos aditivos para tintes de pelo y más requisitos de etiquetado.

🇨🇴 EN COLOMBIA: El INVIMA (Instituto Nacional de Vigilancia de Medicamentos y Alimentos) regula los cosméticos. Colombia adoptó la Decisión 516 de la Comunidad Andina, que armoniza la regulación con estándares internacionales. Los productos importados deben tener notificación sanitaria vigente.

✅ ¿Cómo verificar un producto? Busca en la etiqueta: número de registro INVIMA (Colombia), el lote y fecha de vencimiento, lista de ingredientes (INCI), y las advertencias correspondientes. Desconfía de productos sin información del fabricante, sin lista de ingredientes o con afirmaciones milagrosas sin respaldo. 🌿',
  '{
    "Concern": ["Consumer_Safety", "Regulatory_Compliance", "Product_Verification"],
    "DifficultyLevel": "Intermediate",
    "ScientificEvidence": "High",
    "Source": "MoCRA 2022; EU Regulation 1223/2009; EU 2026/909; INVIMA; Taobe Consulting",
    "Keywords": ["regulacion cosmeticos", "INVIMA", "FDA", "seguridad cosmeticos", "registro sanitario", "ingredientes prohibidos"]
  }'::jsonb
) ON CONFLICT (title) DO NOTHING;


-- Registro de ejecución
DO $$
DECLARE
  total_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_count FROM beauty_knowledge_embeddings;
  RAISE NOTICE '✅ Seed completado. Total de entradas en beauty_knowledge_embeddings: %', total_count;
END $$;
