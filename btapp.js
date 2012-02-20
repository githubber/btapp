// Btapp.js 0.0.1

// (c) 2012 Patrick Williams, BitTorrent Inc.
// Btapp may be freely distributed under the MIT license.
// For all details and documentation:
// http://pwmckenna.github.com/btapp

// Welcome to Btapp!

// This should provide a clean javascript layer above the utorrent/bittorrent
// webui layer (the web interface to a client). It is intended to abstract away
// everything but the objects and the functions that can be called on them.
// There's no need for someone writing	a web app that interacts with the client to
// constantly be doing diffs to see what has changed. In addition, calling long specific
// urls to call a single function on a torrent object is pretty painful, so I added
// functions that dangle off of the objects (in the bt object) that will call the urls
// that will acheive the desired effect and will also handle passing functions as arguments...
// this is similar to soap or rpc...so callbacks should *just work*...in fact, we internally
// rely on this as the	torrentStatus event function is set and the used to keep our models up to date


// some of us are lost in the world without __asm int 3;
function assert(b) { if(!b) debugger; }

// BtappCollection
// -------------

// BtappCollection is a collection of objects in the client...
// currently this can only be used to represent the list of torrents,
// then within the torrents, their list of files...this will eventually
// be used for rss feeds, etc as well.

// BtappModel and BtappCollection both support clearState and updateState
window.BtappCollection = Backbone.Collection.extend({
    initialize: function(models, options) {
        Backbone.Collection.prototype.initialize.apply(this, arguments);
        _.bindAll(this, 'destructor', 'clearState', 'updateState', 'triggerCustomAddEvent', 'triggerCustomRemoveEvent');
        this.initializeValues();

        this.bind('add', this.triggerCustomAddEvent);
        this.bind('remove', this.triggerCustomRemoveEvent);
	},
    initializeValues: function() {
        this.url = '';
        this.session = null;
        this.bt = {};
    },
    destructor: function() {
		this.unbind('add', this.triggerCustomAddEvent);
		this.unbind('remove', this.triggerCustomRemoveEvent);
		
        this.trigger('destroy');
    },
	triggerCustomAddEvent: function(model) {
		this.trigger('add:' + model.id, model);
	},
	triggerCustomRemoveEvent: function(model) {
		this.trigger('remove:' + model.id, model);
	},
    clearState: function() {
        this.each(function(model) {
            model.clearState();
        });
        this.destructor();
        this.reset();
        this.initializeValues();
    },
    updateState: function(session, add, remove, url) {
        var time = (new Date()).getTime();	
        this.session = session;
        if(!this.url) {
            this.url = url;
            this.trigger('change');
        }

        add = add || {};
        remove = remove || {};

        // Iterate over the diffs that came from the client to see what has been added (only in add),
        // removed (only in remove), or changed (old value in remove, new value in add)
        for(var uv in remove) {
            var added = add[uv];
            var removed = remove[uv];
            var v = escape(uv);
            var childurl = url + v + '/';


            // Elements that are in remove aren't necessarily being removed,
            // they might alternatively be the old value of a variable that has changed
            if(!added) {
                // Most native objects coming from the client have an "all" layer before their variables,
                // There is no need for the additional layer in javascript so we just flatten the tree a bit.
                if(v == 'all') {
                    this.updateState(this.session, added, removed, childurl);
                    continue;
                }

                // We only expect objects and functions to be added to collections
                if(typeof removed === 'object') {
                    var model = this.get(v, {'silent': true});
                    assert(model);
                    model.updateState(session, added, removed, childurl);
                    this.remove(model);
                }			
            }
        }
        for(var uv in add) {
            var added = add[uv];
            var removed = remove[uv];
            var v = escape(uv);
            var childurl = url + v + '/';

            // Most native objects coming from the client have an "all" layer before their variables,
            // There is no need for the additional layer in javascript so we just flatten the tree a bit.
            if(v == 'all') {
                this.updateState(this.session, added, removed, childurl);
                continue;
            }

            if(typeof added === 'object') {
                var model = this.get(v, {'silent': true});
                if(!model) {
                    model = new BtappModel({'id':v});
                    model.bind('queries', _.bind(this.trigger, this, 'queries'));
                    model.url = childurl;
                    model.client = this.client;
                    model.updateState(this.session, added, removed, childurl);
                    this.add(model);
                } else {
                    model.updateState(this.session, added, removed, childurl);
                }
            }
        }
        var delta = ((new Date()).getTime() - time);
    }
});

// BtappModel
// -------------

// BtappModel is the base model for most things in the client
// a torrent is a BtappModel, a file is a BtappModel, properties that
// hang off of most BtappModels is also a BtappModel...both BtappModel
// and BtappCollection objects are responsible for taking the json object
// that is returned by the client and turning that into attributes/functions/etc

// BtappModel and BtappCollection both support clearState and updateState
window.BtappModel = Backbone.Model.extend({
    initialize: function(attributes) {
        Backbone.Model.prototype.initialize.apply(this, arguments);
        //assert(this.id); // this is triggering too often (erroneously?)
        _.bindAll(this, 'clearState', 'destructor', 'updateState', 'triggerCustomEvents');
        this.initializeValues();

        this.bind('change', this.triggerCustomEvents);
    },
    destructor: function() {
        this.unbind('change', this.triggerCustomEvents);
        this.trigger('destroy');
    },
    // Override Backbone.Model's get function
    get: function(key, options) {
        var ret = Backbone.Model.prototype.get.apply(this, arguments);
        //We don't want to trigger a query event if this is an internal get used for maintaining the btapp object.
        if(!options || !options.silent) {
            //We also don't care about anything other than the leaves of objects, as intermediate objects are just
            //containers for actual torrent client state information.
            if(!(typeof ret === 'object' && 'clearState' in ret)) {
                //Instead of adding a query for each attribute, lets just filter to the model level...
                //this is probably the sweet spot in terms of client side efficiency. Using too many queries
                //is probably almost as damaging as casting too wide of a net.
                this.trigger('queries', this.url + escape(key) + '/');
            }
        }
        return ret;
    },

    // Because there is so much turbulance in the properties of models (they can come and go
    // as clients are disconnected, torrents/peers added/removed, it made sense to be able to
    // bind to add/remove events on a model for when its attributes change
    triggerCustomEvents: function() {
        var attrs = this.attributes;
        var prev = this.previousAttributes();
        for(var a in attrs) {
            if(!(a in prev)) {
                this.trigger('add:' + a, attrs[a]);
                this.trigger('add', attrs[a]);
            }
        }
        for(var p in prev) {
            if(!(p in attrs)) {
                this.trigger('remove:' + p, prev[p]);
                this.trigger('remove', prev[p]);
            }
        }
    },
    initializeValues: function() {
        this.bt = {};
        this.url = null;
        this.session = null;
    },
    clearState: function() {
        for(a in this.attributes) {
            var attribute = this.attributes[a];
            if(typeof attribute === 'object' && 'clearState' in attribute) {
                attribute.clearState();
            }
        }
        this.destructor();
        this.clear();
        this.initializeValues();
    },
    updateState: function(session, add, remove, url) {
        var time = (new Date()).getTime();	
        var changed = false;
        this.session = session;
        if(!this.url) {
            this.url = url;
            changed = true;
        }

        add = add || {};
        remove = remove || {};

        // We're going to iterate over both the added and removed diff trees
        // because elements that change exist in both trees, we won't delete
        // elements that exist in remove if they also exist in add...
        // As a nice verification step, we're also going to verify that the remove
        // diff tree contains the old value when we change it to the value in the add
        // diff tree. This should help ensure that we're completely up to date
        // and haven't missed any state dumps
        for(var uv in remove) {
            var added = add[uv];
            var removed = remove[uv];
            var v = escape(uv);
            var childurl = url + v + '/';

            if(!added) {
                //special case all
                if(v == 'all') {
                    this.updateState(this.session, added, removed, childurl);
                    continue;
                }

                if(typeof removed === 'object') {
                    //Update state downstream from here. Then remove from the collection.
                    var model = this.get(v, {'silent': true});
                    assert(model);
                    assert('updateState' in model);
                    model.updateState(session, added, removed, childurl);
                    this.unset(v, {silent: true});
                    changed = true;
                } else if(typeof removed === 'string' && this.client.isFunctionSignature(removed)) {
                    assert(v in this.bt);
                    this.trigger('remove:bt.' + v, this.bt[v]);
                    delete this.bt[v];
                    changed = true;
                } else if(v != 'id') {
                    assert(this.get(v, {'silent': true}) == unescape(removed));
                    this.unset(v, {silent: true});
                    changed = true;
                }
            }
        }

        for(var uv in add) {
            var added = add[uv];
            var removed = remove[uv];
            var v = escape(uv);

            var param = {};
            var childurl = url + v + '/';

            // Special case all. It is a redundant layer that exist for the benefit of the torrent client
            if(v == 'all') {
                this.updateState(this.session, added, removed, childurl);
                continue;
            }

            if(typeof added === 'object') {
                // Don't recreate a variable we already have. Just update it.
                var model = this.get(v, {'silent': true});
                if(!model) {
                    // This is the only hard coding that we should do in this library...
                    // As a convenience, torrents and their file/peer lists are treated as backbone collections
                    // the same is true of rss_feeds and filters...its just a more intuitive way of using them
                    if(	childurl.match(/btapp\/torrent\/$/) ||
                        childurl.match(/btapp\/torrent\/all\/[^\/]+\/file\/$/) ||
                        childurl.match(/btapp\/torrent\/all\/[^\/]+\/peer\/$/) ||
                        childurl.match(/btapp\/label\/$/) ||
                        childurl.match(/btapp\/label\/all\/[^\/]+\/torrent\/$/) ||
                        childurl.match(/btapp\/label\/all\/[^\/]+\/torrent\/all\/[^\/]+\/file\/jQuery/) ||
                        childurl.match(/btapp\/label\/all\/[^\/]+\/torrent\/all\/[^\/]+\/peer\/jQuery/) ||
                        childurl.match(/btapp\/rss_feed\/$/) ||
                        childurl.match(/btapp\/rss_feed\/all\/[^\/]+\/item\/$/) ||
                        childurl.match(/btapp\/rss_filter\/$/) ) {
                        model = new BtappCollection;
                    } else {
                        model = new BtappModel({'id':v});
                    }
                    model.bind('queries', _.bind(this.trigger, this, 'queries'));
                    model.url = childurl;
                    model.client = this.client;
                    param[v] = model;
                    this.set(param, {server:true, silent:true});
                    changed = true;
                }
                model.updateState(this.session, added, removed, childurl);
            } else if(typeof added === 'string' && this.client.isFunctionSignature(added)) {
                assert(!(v in this.bt));
                this.bt[v] = this.client.createFunction(session, url + v, added);
                this.trigger('add:bt.' + v, this.bt[v]);
                changed = true;
            } else {
                // Set non function/object variables as model attributes
                if(typeof added === 'string') {
                    added = unescape(added);
                }
                param[escape(v)] = added;
                // We need to specify server:true so that our overwritten set function
                // doesn't try to update the client.
                this.set(param, {server:true, silent:true});
                changed = true;
            }	
        }
        if(changed) {
            this.trigger('change');
        }
        var delta = ((new Date()).getTime() - time);
    }
});

// Btapp
// -------------


// Btapp is the root of the client objects' tree, and generally the only object that clients should instantiate.
// This mirrors the original api where document.btapp was the root of everything. generally, this api attempts to be
// as similar as possible to that one...

// BEFORE:
// *btapp.torrent.get('XXX').file.get('XXX').properties.get('name');*
// AFTER:
// *btapp.get('torrent').get('XXX').get('file').get('XXX').get('properties').get('name');*

// The primary difference is that in the original you got the state at that exact moment, where
// we now simply keep the backbone objects up to date (by quick polling and updating as diffs are returned)
// so you can query at your leisure.
window.Btapp = BtappModel.extend({
    initialize: function() {
        BtappModel.prototype.initialize.apply(this, arguments);

        this.url = 'btapp/';
        this.connected_state = false;
        this.client = null;

        //bind stuff
        _.bindAll(this, 'connect', 'disconnect', 'connected', 'fetch', 'onEvents', 'onFetch', 'onConnectionError', 'trackQuery');

        this.tracked_queries = {};
        this.bind('queries', this.trackQuery);
    },
    trackQuery: function(query) {
        query = query.replace(new RegExp('\/all\/[^\/]+\/', 'g'), '\/all\/*\/');
        if(query in this.tracked_queries) {
            this.tracked_queries[query]++;
        } else {
            this.tracked_queries[query] = 1;
        }
    },
    getAccessedQueries: function() {
        return _.keys(this.tracked_queries);
    },
    destructor: function() {
        // We don't want to destruct the base object even when we can't connect...
        // Its event bindings are the only way we'll known when we've re-connected
        // WARNING: this might leak a wee bit if you have numerous connections in your app
    },
    connect: function(attributes) {
        assert(!this.client && !this.connected_state);
        this.connected_state = true;

        // Initialize variables
        attributes = attributes || {};
        this.poll_frequency = attributes.poll_frequency || 3000;
        this.queries = attributes.queries || ['btapp/'];

        // At this point, if a username password combo is provided we assume that we're trying to
        // access a falcon client. If not, default to the client running on your local machine.
        // You can also pass in "remote_data" that is returned from a falcon.serialize()
        attributes.btapp = this;
        
        // We'll check for TorrentClient and assume that FalconTorrentClient and LocalTorrentClient
        // come along for the ride.
        if(window.TorrentClient) {
            this.setClient(attributes);
        } else {
            jQuery.getScript(
                'http://apps.bittorrent.com/torque/btapp/torque.btapp.js',
               _.bind(this.setClient, this, attributes)
            );
        }
    },
    setClient: function(attributes) {
        if(('username' in attributes && 'password' in attributes) || 'remote_data' in attributes) {
            this.client = new FalconTorrentClient(attributes);
        } else {
            this.client = new LocalTorrentClient(attributes);
        }
        // While we don't want app writers having to interact with the client directly,
        // it would be nice to be able to listen in on what's going on...so lets just bubble
        // them up as client:XXX messages
        this.client.bind('all', this.trigger, this);
        this.client.bind('client:connected', this.fetch);		
    },
    disconnect: function() {
        assert(this.client && this.connected_state);
        this.connected_state = false;
        if (this.next_timeout) {
            clearTimeout( this.next_timeout );
        }
        this.client.btapp = null;
        this.client = null;
        this.clearState();
    },
    connected: function() {
        return this.connected_state;
    },
    onConnectionError: function() {
        this.clearState();
        if(this.client) {
            this.client.reset();
        }
    },
    onFetch: function(data) {
        assert('session' in data);
        this.waitForEvents(data.session);
    },
    fetch: function() {
        if(this.client) {
            this.client.query('state', this.queries, null, this.onFetch, this.onConnectionError);
        }
    },
    onEvent: function(session, data) {
        // There are two types of events...state updates and callbacks
        // Handle state updates the same way we handle the initial tree building
        if('add' in data || 'remove' in data) {
            data.add = data.add || {};
            data.remove = data.remove || {};
            this.updateState(session, data.add.btapp, data.remove.btapp, 'btapp/');
        } else if('callback' in data && 'arguments' in data) {
            this.client.btappCallbacks[data.callback](data.arguments);
        } else {
            assert(false);
        }
    },
    // When we get a poll response from the client, we sort through them here, as well as track round trip time.
    // We also don't fire off another poll request until we've finished up here, so we don't overload the client if
    // it is generating a large diff tree. We should generally on get one element in data array. Anything more and
    // the client has wasted energy creating seperate diff trees.
    onEvents: function(time, session, data) {
        if(this.connected_state) {
            for(var i = 0; i < data.length; i++) {
                this.onEvent(session, data[i]);
            }
            this.next_timeout = setTimeout(_.bind(this.waitForEvents, this, session), this.poll_frequency);
        }
    },
    waitForEvents: function(session) {
        if(this.client) {
            this.client.query('update', null, session, _.bind(this.onEvents, this, (new Date()).getTime(), session), this.onConnectionError);
        }
    }
});