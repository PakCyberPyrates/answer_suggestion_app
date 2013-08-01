(function() {

  return {
    doneLoading: false,
    defaultState: 'spinner',
    defaultNumberOfEntriesToDisplay: 10,
    events: {
      // APP EVENTS
      'app.activated'                           : 'initializeIfReady',
      'ticket.status.changed'                   : 'initializeIfReady',
      'ticket.subject.changed'                  : _.debounce(function(){
        this.initialize();
      }, 500),
      // AJAX EVENTS
      'search.done'                             : 'searchDone',
      // DOM EVENTS
      'click,dragend ul.entries a.copy_link'    : 'copyLink',
      'keyup .custom-search input'              : function(event){
        if(event.keyCode === 13)
          return this.processSearchFromInput();
      },
      'click .custom-search button'             : 'processSearchFromInput'
    },

    requests: {
      search: function(query){
        this.switchTo('spinner');

        query = query.replace(/[\.,-\/#!$%\^&\*;:{}=\-_`~()]/g," ")
          .replace(/\s{2,}/g," ");

        return {
          url: this.apiEndpoint() + 'search.json?query=type:topic ' + query,
          type: 'GET'
        };
      },

      fetchTopicsWithForums: function(ids){
        return {
          url: '/api/v2/topics/show_many.json?ids=' + ids.join(',') + '&include=forums',
          type: 'POST'
        };
      }
    },

    searchUrlPrefix: _.memoize(function() {
      return this.setting('search_hc') ? '/hc' : '';
    }),

    apiEndpoint: _.memoize(function(){
      return this.searchUrlPrefix() + '/api/v2/';
    }),

    initializeIfReady: function(){
      if (this.canInitialize()){
        this.initialize();
        this.doneLoading = true;
      }
    },

    canInitialize: function(){
      return (!this.doneLoading &&
              this.ticket());
    },

    initialize: function(){
      if (_.isEmpty(this.ticket().subject()))
        return this.switchTo('no_subject');
      return this.ajax('search', this.subjectSearchQuery());
    },

    searchDone: function(data){
      if (_.isEmpty(data.results))
        return this.switchTo('no_entries');

      if (this.setting('search_hc')){
        this.renderList(this.formatHcEntries(data.results));
      } else {
        var topics = data.results;

        this.ajax('fetchTopicsWithForums', _.map(topics, function(topic) { return topic.id; }))
          .done(function(data){
            this.renderList(this.formatEntries(topics, data));
          });
      }
    },

    renderList: function(data){
      if (_.isEmpty(data.entries))
        return this.switchTo('no_entries');

      this.switchTo('list', data);

      this.$('a').tooltip({
        trigger: 'hover',
        placement: 'left'
      });
    },

    formatEntries: function(topics, result){
      var entries = _.inject(topics, function(memo, topic){
        var forum = _.find(result.forums, function(f){ return f.id == topic.forum_id; });

        var entry = {
          id: topic.id,
          url: this.baseUrl() + 'entries/' + topic.id,
          title: topic.title,
          preview: this.truncate(topic.body, 100),
          agent_only: !!forum.access.match("agents only")
        };

        if ( !(this.setting('exclude_agent_only') && entry.agent_only)){
          memo.push(entry);
        }

        return memo;
      }, [], this);

      return { entries: entries.slice(0,this.numberOfDisplayableEntries()) };
    },

    formatHcEntries: function(result){
      var entries = _.inject(result.slice(0,this.numberOfDisplayableEntries()),
                             function(memo, entry){
                               var title = entry.name;

                               memo.push({
                                 id: entry.id,
                                 url: entry.html_url,
                                 title: title,
                                 truncated_title: this.truncate(title)
                               });
                               return memo;
                             }, [], this);

      return { entries: entries };
    },

    processSearchFromInput: function(){
      this.ajax('search', this.$('.custom-search input').val());
    },

    baseUrl: function(){
      if (this.setting('custom_host'))
        return this.setting('custom_host');
      return "https://" + this.currentAccount().subdomain() + ".zendesk.com/";
    },

    truncate: function(str, custom_limit){
      var limit = custom_limit|45;

      if (str.length < limit)
        return str;
      return str.slice(0,limit) + '...';
    },

    copyLink: function(event){
      event.preventDefault();
      var content = "";

      if (this.setting('include_title')) { content = event.currentTarget.title + ' - '; }

      content += event.currentTarget.href;

      return this.appendToComment(content);
    },

    appendToComment: function(text){
      var old_text = _.isEmpty(this.comment().text()) ? '' : this.comment().text() + '\n';
      return this.comment().text( old_text + text);
    },

    stop_words: _.memoize(function(){
      return _.map(this.I18n.t("stop_words").split(','), function(word) { return word.trim(); });
    }),

    numberOfDisplayableEntries: function(){
      return this.setting('nb_entries') || this.defaultNumberOfEntriesToDisplay;
    },

    // extracted from http://geeklad.com/remove-stop-words-in-javascript
    removeStopWords: function(str, stop_words){
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
      // Remove punctuation and trim
      return str.replace(/[\!\?\,\.\;]/g,"")
        .replace(/^\s+|\s+$/g, "");
    },

    subjectSearchQuery: function(s){
      return this.removeStopWords(this.ticket().subject(), this.stop_words());
    }
  };
}());
