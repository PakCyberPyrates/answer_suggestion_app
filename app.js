(function() {
  return {
    defaultState: 'spinner',
    defaultNumberOfEntriesToDisplay: 10,
    zendeskRegex: /^https:\/\/(.*?)\.(?:zendesk|zd-(?:dev|master|staging))\.com\//,
    DEFAULT_LOGO_URL: '/images/logo_placeholder.png',

    events: {
      // APP EVENTS
      'app.created': 'created',
      'ticket.subject.changed': _.debounce(function(){ this.initialize(); }, 500),

      // AJAX EVENTS
      'searchHelpCenter.done': 'searchHelpCenterDone',
      'getHcArticle.done': 'getHcArticleDone',
      'getSectionAccessPolicy.done': 'getSectionAccessPolicyDone',
      'settings.done': 'settingsDone',

      // DOM EVENTS
      'zd_ui_change .brand-filter': 'processSearchFromInput',
      'zd_ui_change .locale-filter': 'processSearchFromInput',
      'click a.preview_link': 'previewLink',
      'click a.copy_link': 'copyLink',
      //rich text editor has built in drag and drop of links so we should only fire
      //the dragend event when users are using Markdown or text.
      'dragend': function(event){ if (!this.useRichText) this.copyLink(event); },
      'click .toggle-app': 'toggleAppContainer',
      'keyup .custom-search input': function(event){
        if (event.keyCode === 13) { return this.processSearchFromInput(); }
      },
      'click .custom-search .search-btn': 'processSearchFromInput'
    },

    requests: {
      settings: {
        url: '/api/v2/account/settings.json',
        type: 'GET'
      },

      getBrands: {
        url: '/api/v2/brands.json',
        type: 'GET'
      },

      getLocales: {
        url: '/api/v2/locales.json',
        type: 'GET'
      },

      getHcArticle: function(id) {
        return {
          url: helpers.fmt('/api/v2/help_center/articles/%@.json?include=translations', id),
          type: 'GET'
        };
      },

      getSectionAccessPolicy: function(sectionId) {
        return {
          url: helpers.fmt('/api/v2/help_center/sections/%@/access_policy.json', sectionId),
          type: 'GET'
        };
      },

      searchHelpCenter: function(query) {
        var url = '/api/v2/help_center/articles/search.json',
            data = {
              per_page: this.queryLimit(),
              query: query
            };

        if (this.isMultilocale) {
          data.locale = this.$('.locale-filter').zdSelectMenu('value');
        }

        if (this.isMultibrand) {
          url = '/api/v2/search.json';
          data.brand_id = this.$('.brand-filter').zdSelectMenu('value');
          data.query = 'type:article ' + data.query;

          if (data.brand_id !== 'any') {
            data.query = 'brand:' + data.brand_id + ' ' + data.query;
          }
        }

        return {
          type: 'GET',
          url: url,
          data: data
        };
      },

      fetchTopicsWithForums: function(ids){
        return {
          url: helpers.fmt('/api/v2/topics/show_many.json?ids=%@&include=forums', ids.join(',')),
          type: 'POST'
        };
      }
    },

    search: function(query) {
      this.switchTo('spinner');

      this.ajax('searchHelpCenter', query);
    },

    created: function() {
      this.isMultilocale = false;
      this.isMultibrand = false;

      this.when(
        this.ajax('getBrands'),
        this.ajax('getLocales')
      ).then(function(brandsResponse, localeResponse) {
        var brandsData = brandsResponse[0],
            localeData = localeResponse[0];

        var brands = this.filterBrands(brandsData.brands);
        this.isMultibrand = brands.length > 1;

        /* if multibrand, you can't search for locales because the HC API doesn't support that */
        this.isMultilocale = !this.isMultibrand && localeData.count > 1;

        if (this.isMultibrand) { this.getBrandsDone(brandsData); }
        if (this.isMultilocale) { this.getLocalesDone(localeData); }
      }.bind(this));

      this.initialize();
    },

    initialize: function(){
      this.useRichText = this.ticket().comment().useRichText();

      this.ajax('settings').then(function() {
        if (_.isEmpty(this.ticket().subject())) {
          return this.switchTo('no_subject');
        }

        var subject = this.subjectSearchQuery();
        if (subject) {
          this.search(subject);
        } else {
          this.switchTo('list');
        }
      }.bind(this));
    },

    settingsDone: function(data) {
      this.useMarkdown = data.settings.tickets.markdown_ticket_comments;
    },

    hcArticleLocaleContent: function(data) {
      var currentLocale = this.isMultilocale ? this.$('.locale-filter').zdSelectMenu('value') : this.currentUser().locale(),
          translations = data.article.translations;

      var localizedTranslation = _.find(translations, function(translation) {
        return translation.locale.toLowerCase() === currentLocale.toLowerCase();
      });

      return localizedTranslation && localizedTranslation.body || translations[0].body;
    },

    renderAgentOnlyAlert: function() {
      var alert = this.renderTemplate('alert');
      this.$('#detailsModal .modal-body').prepend(alert);
    },

    isAgentOnlyContent: function(data) {
      return data.agent_only || data.access_policy && data.access_policy.viewable_by !== 'everybody';
    },

    getBrandsDone: function(data) {
      var filteredBrands = this.filterBrands(data.brands);
      if (this.isMultibrand) {
        var options = _.map(filteredBrands, function(brand) {
          return { value: brand.id, label: brand.name };
        });
        this.$('.custom-search').before(
          this.renderTemplate('brand_filter', { options: options })
        );
        this.$('.brand-filter').zdSelectMenu();
      }

      this.brandsInfo = _.object(_.map(filteredBrands, function(brand) {
        return [brand.name, brand.logo && brand.logo.content_url];
      }));
    },

    getLocalesDone: function(data) {
      if (!this.isMultilocale) return;

      var options = _.map(data.locales, function(locale) {
        var data = {
          value: locale.locale,
          label: locale.name
        };
        if (this.currentUser().locale() === locale.locale) { data.selected = 'selected'; }
        return data;
      }, this);

      this.$('.custom-search').before(
        this.renderTemplate('locale_filter', { options: options })
      );

      this.$('.locale-filter').zdSelectMenu();
    },

    getHcArticleDone: function(data) {
      if (data.article && data.article.section_id) {
        this.ajax('getSectionAccessPolicy', data.article.section_id);
      }

      var modalContent = this.hcArticleLocaleContent(data);
      this.updateModalContent(modalContent);
    },

    updateModalContent: function(modalContent) {
      this.$('#detailsModal .modal-body .content-body').html(modalContent);
    },

    getSectionAccessPolicyDone: function(data) {
      if (this.isAgentOnlyContent(data)) { this.renderAgentOnlyAlert(); }
    },

    searchHelpCenterDone: function(data) {
      this.renderList(this.formatHcEntries(data.results));
    },

    renderList: function(data){
      if (_.isEmpty(data.entries)) {
        this.switchTo('no_entries');
      } else {
        this.switchTo('list', data);
        this.$('.brand-logo').tooltip();
      }
    },

    formatHcEntries: function(result){
      var slicedResult = result.slice(0, this.numberOfDisplayableEntries());
      var entries = _.inject(slicedResult, function(memo, entry) {
        var title = entry.name,
            zendeskUrl = entry.html_url.match(this.zendeskRegex),
            subdomain = zendeskUrl && zendeskUrl[1];

        memo.push({
          id: entry.id,
          url: entry.html_url,
          title: entry.name,
          subdomain: subdomain,
          body: entry.body,
          brandName: entry.brand_name,
          brandLogo: this.brandsInfo && this.brandsInfo[entry.brand_name] || this.DEFAULT_LOGO_URL,
          isMultibrand: this.isMultibrand
        });
        return memo;
      }, [], this);

      return { entries: entries };
    },

    processSearchFromInput: function() {
      var query = this.removePunctuation(this.$('.custom-search input').val());
      if (query && query.length) { this.search(query); }
    },

    baseUrl: function() {
      if (this.setting('custom_host')) {
        var host = this.setting('custom_host');
        if (host[host.length - 1] !== '/') { host += '/'; }
        return host;
      }
      return helpers.fmt("https://%@.zendesk.com/", this.currentAccount().subdomain());
    },

    previewLink: function(event){
      event.preventDefault();
      var $link = this.$(event.target).closest('a');
      $link.parent().parent().parent().removeClass('open');
      var $modal = this.$("#detailsModal");
      $modal.html(this.renderTemplate('modal', {
        title: $link.closest('.entry').data('title'),
        link: $link.attr('href')
      }));
      $modal.modal();
      this.getContentFor($link);
    },

    copyLink: function(event) {
      event.preventDefault();
      var content = "";

      var title = event.target.title;
      var link = event.target.href;

      if (this.useMarkdown) {
        content = helpers.fmt("[%@](%@)", title, link);
      }
      else if (this.useRichText){
        content = helpers.fmt("<a href='%@' target='_blank'>%@</a>", _.escape(link), _.escape(title));
      }
      else {
        if (this.setting('include_title')) {
          content = title + ' - ';
        }
        content += link;
      }
      return this.appendToComment(content);
    },

    renderTopicContent: function(id) {
      var topic = _.find(this.store('entries').entries, function(entry) {
        return entry.id == id;
      });
      this.updateModalContent(topic.body);
      if (this.isAgentOnlyContent(topic)) { this.renderAgentOnlyAlert(); }
    },

    getContentFor: function($link) {
      var subdomain = $link.data('subdomain');
      if (!subdomain || subdomain !== this.currentAccount().subdomain()) {
        this.updateModalContent($link.data('articleBody'));
      } else {
        this.ajax('getHcArticle', $link.data('id'));
      }
    },

    appendToComment: function(text){
      return this.useRichText ? this.comment().appendHtml(text) : this.comment().appendText(text);
    },

    stop_words: _.memoize(function(){
      return _.map(this.I18n.t("stop_words").split(','), function(word) { return word.trim(); });
    }),

    numberOfDisplayableEntries: function(){
      return this.setting('nb_entries') || this.defaultNumberOfEntriesToDisplay;
    },

    queryLimit: function(){
      // ugly hack to return more results than needed because we filter out agent only content
      if (this.setting('exclude_agent_only')) {
        return this.numberOfDisplayableEntries() * 2;
      } else {
        return this.numberOfDisplayableEntries();
      }
    },

    removeStopWords: function(str, stop_words){
      // Remove punctuation and trim
      str = this.removePunctuation(str);
      var words = str.match(/[^\s]+|\s+[^\s+]$/g);
      var x,y = 0;

      for(x=0; x < words.length; x++) {
        // For each word, check all the stop words
        for(y=0; y < stop_words.length; y++) {
          // Get the current word
          var word = words[x].replace(/\s+|[^a-z]+\'/ig, "");

          // Get the stop word
          var stop_word = stop_words[y];

          // If the word matches the stop word, remove it from the keywords
          if(word.toLowerCase() == stop_word) {
            // Build the regex
            var regex_str = "^\\s*"+stop_word+"\\s*$";// Only word
            regex_str += "|^\\s*"+stop_word+"\\s+";// First word
            regex_str += "|\\s+"+stop_word+"\\s*$";// Last word
            regex_str += "|\\s+"+stop_word+"\\s+";// Word somewhere in the middle

            var regex = new RegExp(regex_str, "ig");

            str = str.replace(regex, " ");
          }
        }
      }

      return str.trim();
    },

    removePunctuation: function(str){
      return str.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ")
        .replace(/\s{2,}/g," ");
    },

    subjectSearchQuery: function(s){
      return this.removeStopWords(this.ticket().subject(), this.stop_words());
    },

    toggleAppContainer: function(){
      var $container = this.$('.app-container'),
      $icon = this.$('.toggle-app i');

      if ($container.is(':visible')){
        $container.hide();
        $icon.prop('class', 'icon-plus');
      } else {
        $container.show();
        $icon.prop('class', 'icon-minus');
      }
    },

    filterBrands: function(brands){
      return _.filter(brands, function(element){
        return element.active && element.help_center_state === "enabled";
      });
    },
  };
}());
