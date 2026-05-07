(function () {
  if (!document.documentElement || document.documentElement.lang !== "ar") {
    return;
  }

  var exactMap = {
    "Play": "تشغيل",
    "Pause": "إيقاف",
    "Preview": "معاينة",
    "Change": "تغيير الملف",
    "Loop selection": "تكرار المقطع",
    "Reset": "إعادة ضبط",
    "Fade In": "تدرج دخول",
    "Fade Out": "تدرج خروج",
    "Download MP3": "تحميل MP3",
    "Download WAV": "تحميل WAV",
    "No file selected": "لم يتم اختيار ملف",
    "Change file": "تغيير الملف",
    "Start over": "ابدأ من جديد",
    "Upload a file to begin transcription": "ارفع ملفًا لبدء التفريغ.",
    "Transcription runs entirely in your browser, so your media never leaves your device.": "تتم المعالجة داخل المتصفح، لذلك تبقى ملفاتك على جهازك.",
    "Select transcription language": "اختر لغة التفريغ",
    "Choose language for best accuracy": "اختر اللغة للحصول على أفضل دقة",
    "Enhance audio": "تحسين الصوت",
    "Cleaner speech for noisy recordings": "صوت أوضح للتسجيلات المليئة بالضجيج",
    "Normalizes volume before transcription. Slightly slower, but often worth it for rough audio.": "يضبط مستوى الصوت قبل التفريغ. أبطأ قليلًا لكنه مفيد غالبًا مع التسجيلات الضعيفة.",
    "Transcribe": "ابدأ التفريغ",
    "Transcribe unavailable": "التفريغ غير متاح",
    "Retry model download": "أعد تنزيل النموذج",
    "Select language first": "اختر اللغة أولًا",
    "Original": "النص الأصلي",
    "Translated": "الترجمة",
    "Edit transcript": "تحرير النص",
    "Show Timestamps": "إظهار التوقيت",
    "Transcription will appear here after processing.": "سيظهر النص هنا بعد انتهاء المعالجة.",
    "Translate transcript": "ترجمة النص",
    "Refine with ChatGPT": "تحسين عبر ChatGPT",
    "Transcript language": "لغة النص",
    "Select transcript language": "اختر لغة النص",
    "Translate to": "الترجمة إلى",
    "Select target language": "اختر اللغة الهدف",
    "Translation mode": "وضع الترجمة",
    "Accurate (word-by-word)": "دقيق (كلمة بكلمة)",
    "Subtitle (short & readable)": "ترجمة فيديو (قصيرة وواضحة)",
    "Improve readability (beta)": "تحسين الصياغة (تجريبي)",
    "Start translation": "ابدأ الترجمة",
    "Copy": "نسخ",
    "Download TXT": "تحميل TXT",
    "Download SRT": "تحميل SRT",
    "Download VTT": "تحميل VTT",
    "Selected": "محدد",
    "Source": "المصدر",
    "No matching languages found.": "لم يتم العثور على لغة مطابقة.",
    "Downloading": "جارٍ التنزيل",
    "Ready": "جاهز",
    "Disabled": "غير متاح",
    "Waiting": "بانتظار الدور",
    "Retry": "إعادة المحاولة",
    "Available": "متاح",
    "Fastest multilingual mode for weaker phones.": "أسرع وضع متعدد اللغات للأجهزة الأضعف.",
    "Balanced multilingual mode for most devices.": "وضع متوازن متعدد اللغات لمعظم الأجهزة.",
    "Best multilingual accuracy for stronger desktops.": "أفضل دقة متعددة اللغات للأجهزة الأقوى.",
    "Local transcription unavailable on this browser": "التفريغ المحلي غير متاح في هذا المتصفح.",
    "Phone-optimized local AI available": "ذكاء اصطناعي محلي مناسب للجوال متاح.",
    "High-performance local AI available": "ذكاء اصطناعي محلي عالي الأداء متاح.",
    "Local AI available in compatibility mode": "الذكاء الاصطناعي المحلي متاح في وضع التوافق.",
    "Waiting for model access": "بانتظار الوصول إلى النموذج"
  };

  var placeholderMap = {
    "Search language or code": "ابحث عن اللغة أو الرمز",
    "Search transcript language": "ابحث عن لغة النص",
    "Search target language": "ابحث عن اللغة الهدف"
  };

  function replaceExact(text) {
    var value = String(text || "").trim();
    return exactMap[value] || value;
  }

  function setTextIfChanged(node, nextText) {
    if (!node) {
      return;
    }

    var current = String(node.textContent || "");
    var next = String(nextText || "");

    if (current !== next) {
      node.textContent = next;
    }
  }

  function translateTrimStatus(text) {
    var value = String(text || "").trim();

    if (value === "Upload a file to begin trimming.") {
      return "ارفع ملفًا لبدء قص الصوت.";
    }
    if (value === "Decoding audio...") {
      return "جاري تجهيز الصوت...";
    }
    if (value === "Ready. Drag handles to trim and press Play.") {
      return "الملف جاهز. حرّك المؤشرين لتحديد المقطع ثم اضغط تشغيل.";
    }
    if (value === "Trim region reset.") {
      return "تمت إعادة تعيين نطاق القص.";
    }
    if (value === "Encoding MP3...") {
      return "جاري إنشاء MP3...";
    }
    if (value === "WAV ready. Download started.") {
      return "ملف WAV جاهز. بدأ التنزيل.";
    }
    if (value === "WAV export failed.") {
      return "تعذّر تصدير WAV.";
    }
    if (value === "MP3 ready. Download started.") {
      return "ملف MP3 جاهز. بدأ التنزيل.";
    }
    if (value.indexOf("MP3 export failed:") === 0) {
      return "تعذّر تصدير MP3: " + value.replace("MP3 export failed:", "").trim();
    }
    if (value.indexOf("Failed to load audio file.") === 0) {
      return "تعذّر تحميل الملف الصوتي. جرّب ملفًا آخر إذا استمرت المشكلة.";
    }
    if (value === "This audio format is not supported by your browser. Supported formats depend on your browser. MP3, WAV, and M4A work on most devices.") {
      return "هذا التنسيق غير مدعوم في متصفحك. يعتمد الدعم على المتصفح، لكن MP3 وWAV وM4A تعمل على معظم الأجهزة.";
    }

    return replaceExact(value);
  }

  function translateTranscribeStatus(text) {
    var value = String(text || "").trim();
    var match;

    if (!value) {
      return value;
    }

    if (value === "Preparing audio...") {
      return "جاري تجهيز الملف...";
    }
    if (value === "Downloading model...") {
      return "جاري تنزيل النموذج...";
    }
    if (value === "Preparing browser AI...") {
      return "جاري تجهيز الذكاء الاصطناعي داخل المتصفح...";
    }
    if (value === "Checking your cached AI model so transcription can stay local in this browser.") {
      return "يجري التحقق من نموذج الذكاء الاصطناعي المخزن محليًا حتى يبقى التفريغ داخل هذا المتصفح.";
    }
    if (value === "Running this for the first time? Downloading the model may take up to several seconds or a few minutes depending on your internet speed. Please hang in there, we are cooking for you.") {
      return "هذه أول مرة؟ قد يستغرق تنزيل النموذج بضع ثوانٍ أو دقائق حسب سرعة الإنترنت. انتظر قليلًا حتى يكتمل التجهيز.";
    }
    if (value === "Transcribing in browser...") {
      return "جاري التفريغ داخل المتصفح...";
    }
    if (value === "Still working locally in your browser...") {
      return "ما زالت المعالجة تعمل محليًا داخل المتصفح...";
    }
    if (value === "Transcription complete") {
      return "اكتمل التفريغ.";
    }
    if (value === "Translation complete") {
      return "اكتملت الترجمة.";
    }
    if (value === "Model files downloaded. Finishing browser setup...") {
      return "تم تنزيل ملفات النموذج. جاري إكمال التجهيز داخل المتصفح...";
    }
    if (value === "Finalizing translation...") {
      return "جاري إنهاء الترجمة...";
    }
    if (value === "Preparing translation model...") {
      return "جاري تجهيز نموذج الترجمة...";
    }
    if (value === "Translating transcript...") {
      return "جاري ترجمة النص...";
    }
    if (value === "File must be under 180 seconds for now.") {
      return "يجب أن يكون الملف أقل من 180 ثانية حاليًا.";
    }
    if (value === "Unsupported or corrupted file") {
      return "الملف غير مدعوم أو تالف.";
    }
    if (value === "Failed to load AI model. Check your internet connection.") {
      return "تعذّر تحميل نموذج الذكاء الاصطناعي. تحقّق من اتصال الإنترنت.";
    }
    if (value === "Transcription failed. Try a shorter or clearer file.") {
      return "تعذّر التفريغ. جرّب ملفًا أقصر أو أوضح.";
    }
    if (value === "Translation could not be completed. Try a shorter or clearer input.") {
      return "تعذّرت الترجمة. جرّب نصًا أقصر أو أوضح.";
    }
    if (value === "Choose the spoken language before transcribing for best accuracy.") {
      return "اختر اللغة المنطوقة قبل بدء التفريغ للحصول على دقة أفضل.";
    }
    if (value === "Another transcription tab is holding the AI model. Wait a moment or close the other tab.") {
      return "هناك تبويب آخر يستخدم نموذج الذكاء الاصطناعي الآن. انتظر قليلًا أو أغلق التبويب الآخر.";
    }
    if (value === "Choose the transcript language before translating.") {
      return "اختر لغة النص قبل الترجمة.";
    }
    if (value === "Choose a supported target language.") {
      return "اختر لغة هدف مدعومة.";
    }
    if (value === "Source and target languages are the same") {
      return "لغة المصدر ولغة الهدف متطابقتان.";
    }
    if (value === "No transcript lines are ready to translate.") {
      return "لا توجد أسطر جاهزة للترجمة.";
    }
    if (value === "Only one file can be processed at a time") {
      return "يمكن معالجة ملف واحد فقط في كل مرة.";
    }
    if (value === "Your browser does not support audio processing") {
      return "متصفحك لا يدعم معالجة الصوت.";
    }
    if (value === "No clear speech detected. Try Enhance audio or use a cleaner recording.") {
      return "لم يتم اكتشاف كلام واضح. جرّب تحسين الصوت أو استخدم تسجيلًا أوضح.";
    }
    if (value === "Transcript ready. Review repeated sections and choose the language manually if needed.") {
      return "النص جاهز. راجع الأجزاء المكررة واختر اللغة يدويًا إذا لزم الأمر.";
    }
    if (value === "Transcript ready. Review repeated sections before exporting or translating.") {
      return "النص جاهز. راجع الأجزاء المكررة قبل التصدير أو الترجمة.";
    }
    if (value === "Translate your transcript to view it here.") {
      return "ترجم النص لعرضه هنا.";
    }
    if (value === "Translation line count mismatch. Showing original text.") {
      return "عدد أسطر الترجمة لا يطابق النص. يتم عرض النص الأصلي.";
    }

    match = value.match(/^Downloading (.+)\.\.\. (\d+)%$/);
    if (match) {
      return "جاري تنزيل " + match[1] + "... " + match[2] + "%";
    }

    match = value.match(/^Preparing (.+)\.\.\.$/);
    if (match) {
      return "جاري تجهيز " + match[1] + "...";
    }

    match = value.match(/^Finalizing (.+) in your browser\.\.\.$/);
    if (match) {
      return "جاري إكمال تجهيز " + match[1] + " داخل المتصفح...";
    }

    match = value.match(/^(.+) is ready\. Press Transcribe when you're ready\.$/);
    if (match) {
      return match[1] + " جاهز. اضغط ابدأ التفريغ عندما تكون مستعدًا.";
    }

    match = value.match(/^(.+) downloaded and ready\.$/);
    if (match) {
      return "تم تنزيل " + match[1] + " وهو جاهز.";
    }

    match = value.match(/^(.+) downloaded and ready\. Press Transcribe when you're ready\.$/);
    if (match) {
      return "تم تنزيل " + match[1] + " وهو جاهز. اضغط ابدأ التفريغ عندما تكون مستعدًا.";
    }

    match = value.match(/^(.+) ready from cache\.$/);
    if (match) {
      return match[1] + " جاهز من الذاكرة المحلية.";
    }

    match = value.match(/^(.+) ready from cache\. Press Transcribe when you're ready\.$/);
    if (match) {
      return match[1] + " جاهز من الذاكرة المحلية. اضغط ابدأ التفريغ عندما تكون مستعدًا.";
    }

    match = value.match(/^(.+) is disabled on this device\.\s*(.+)$/);
    if (match) {
      return match[1] + " غير متاح على هذا الجهاز. " + replaceExact(match[2]);
    }

    match = value.match(/^Audio ready for transcription\. Choose the spoken language while (.+) gets ready\.$/);
    if (match) {
      return "الملف جاهز للتفريغ. اختر اللغة المنطوقة بينما يتم تجهيز " + match[1] + ".";
    }

    match = value.match(/^Transcribing in browser\.\.\. (\d+)%$/);
    if (match) {
      return "جاري التفريغ داخل المتصفح... " + match[1] + "%";
    }

    return replaceExact(value);
  }

  function translateTranslationHint(text) {
    var value = String(text || "").trim();
    var match;

    if (!value) {
      return value;
    }

    if (value === "Translation uses your transcript, including any segment edits. Choose the transcript language carefully for best results.") {
      return "تستخدم الترجمة النص الحالي بما في ذلك أي تعديلات على المقاطع. اختر لغة النص بعناية للحصول على أفضل نتيجة.";
    }
    if (value === "Choose a target language different from the transcript language.") {
      return "اختر لغة هدف مختلفة عن لغة النص.";
    }

    match = value.match(/^Transcript language is set to (.+)\. Choose a different target language to translate your edited transcript\.$/);
    if (match) {
      return "تم تحديد لغة النص على " + match[1] + ". اختر لغة هدف مختلفة لترجمة النص المعدّل.";
    }

    match = value.match(/^Translating from (.+) to (.+)\. Any segment edits will be included\.$/);
    if (match) {
      return "تجري الترجمة من " + match[1] + " إلى " + match[2] + ". سيتم تضمين أي تعديلات على المقاطع.";
    }

    return replaceExact(value);
  }

  function applyLeafTranslations(root) {
    if (!root) {
      return;
    }

    function shouldSkipLeafNode(node) {
      var transcriptRoot = node.closest('[data-role="transcript"]');
      if (transcriptRoot && transcriptRoot.querySelector('.ts-paragraph, .ts-segment-text, .ts-time-inline, [data-segment-editor]')) {
        return true;
      }

      return !!node.closest('.ts-paragraph, .ts-segment-text, .ts-time-inline, [data-segment-editor], [data-role="fileName"]');
    }

    root.querySelectorAll("*").forEach(function (node) {
      if (node.children.length) {
        return;
      }
      if (shouldSkipLeafNode(node)) {
        return;
      }
      var next = replaceExact(node.textContent);
      if (next !== String(node.textContent || "").trim()) {
        setTextIfChanged(node, next);
      }
    });
  }

  function applyAttributeTranslations(root) {
    if (!root) {
      return;
    }

    root.querySelectorAll("input[placeholder]").forEach(function (input) {
      var current = String(input.getAttribute("placeholder") || "").trim();
      if (placeholderMap[current]) {
        var next = placeholderMap[current];
        if (input.getAttribute("placeholder") !== next) {
          input.setAttribute("placeholder", next);
        }
      }
    });
  }

  function observeLocalizedRoot(root, applyFn) {
    if (!root || root.__arObserverBound) {
      return;
    }

    var scheduled = false;
    var observer = new MutationObserver(function () {
      if (scheduled) {
        return;
      }

      scheduled = true;
      window.requestAnimationFrame(function () {
        scheduled = false;
        applyFn();
      });
    });

    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["placeholder"]
    });

    root.__arObserverBound = true;
  }

  function localizeTrimPage() {
    var toolRoot = document.getElementById("audio-tool");
    if (!toolRoot) {
      return;
    }

    function apply() {
      applyLeafTranslations(toolRoot);

      var statusEl = toolRoot.querySelector('[data-role="status"]');
      if (statusEl) {
        setTextIfChanged(statusEl, translateTrimStatus(statusEl.textContent));
      }
    }

    apply();
    observeLocalizedRoot(toolRoot, apply);
  }

  function localizeTranscribeRoot(root) {
    if (!root) {
      return;
    }

    function apply() {
      applyLeafTranslations(root);
      applyAttributeTranslations(root);

      var statusEl = root.querySelector('[data-role="status"]');
      var progressMessageEl = root.querySelector("#progress-message");
      var hintEl = root.querySelector('[data-role="translationHint"]');

      if (statusEl) {
        setTextIfChanged(statusEl, translateTranscribeStatus(statusEl.textContent));
      }
      if (progressMessageEl) {
        setTextIfChanged(progressMessageEl, translateTranscribeStatus(progressMessageEl.textContent));
      }
      if (hintEl) {
        setTextIfChanged(hintEl, translateTranslationHint(hintEl.textContent));
      }
    }

    apply();
    observeLocalizedRoot(root, apply);
  }

  function wrapTranscribeInitializer() {
    if (typeof window.initTranscribeTool !== "function" || window.initTranscribeTool.__arWrapped) {
      return;
    }

    var original = window.initTranscribeTool;
    window.initTranscribeTool = function (target) {
      var result = original.apply(this, arguments);
      var root = typeof target === "string" || !target
        ? document.querySelector(target || "#audio-tool")
        : target;
      localizeTranscribeRoot(root);
      return result;
    };
    window.initTranscribeTool.__arWrapped = true;
  }

  wrapTranscribeInitializer();

  document.addEventListener("DOMContentLoaded", function () {
    wrapTranscribeInitializer();

    if (window.location.pathname === "/ar/" || window.location.pathname === "/ar/index.html") {
      localizeTrimPage();
    }

    if (window.location.pathname === "/ar/audio-video-transcription-online.html") {
      localizeTranscribeRoot(document.getElementById("audio-tool"));
    }
  });
})();
